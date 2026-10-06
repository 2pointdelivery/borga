import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ean13CheckDigit, internalBarcode, isEan13, nextBarcodeSequence, assignBarcode, ean13Bars,
  roundMoney, recomputeCosting, stockByWarehouse, totalOnHand, stockStatus, valuation,
  buildPosSale, refundMovements, nextPosNumber, templateDescription, descriptionPrompt, serviceItemsFromTracks,
  saleFinanceEntries, refundFinanceEntries, saleJournals, refundJournals, ledgerPaymentMethod,
  type InventoryItem, type StockMovement, type PosSale,
} from './borga/inventory';
import { INITIAL_COA, type GlAccount, type JournalEntry } from './borga/data';

// ---------------------------------------------------------------------------
// EAN-13 barcodes
// ---------------------------------------------------------------------------

test('EAN-13 check digit matches the standard algorithm', () => {
  // Classic known vector: 400638133393 -> check digit 1.
  assert.equal(ean13CheckDigit('400638133393'), 1);
  assert.equal(ean13CheckDigit('000000000000'), 0);
  // 12 nines: sum 6*9 + 6*9*3 = 216 -> check (10-6) = 4
  assert.equal(ean13CheckDigit('999999999999'), 4);
  assert.throws(() => ean13CheckDigit('12x456789012'));
});

test('internal barcodes are valid EAN-13s in the reserved in-store range', () => {
  const a = internalBarcode(0);
  const b = internalBarcode(1);
  const big = internalBarcode(99999999999);
  assert.equal(a, '2000000000008');
  assert.ok(a.startsWith('2') && a.length === 13, 'in-store range starts with 2');
  assert.ok(isEan13(a) && isEan13(b) && isEan13(big));
  assert.notEqual(a, b);
  assert.equal(big.length, 13);
  assert.throws(() => internalBarcode(-1));
  assert.equal(isEan13('20000000000000'), false, 'bad check digit must fail');
  assert.equal(isEan13('12345'), false);
});

test('barcode assignment is unique and continues from the highest existing', () => {
  const mk = (barcode: string): InventoryItem => ({
    id: `i${barcode}`, name: 'x', type: 'product', sku: '', barcode, category: '', description: '',
    unit: 'ea', costPrice: 0, price: 0, taxRate: 0, trackStock: true, reorderPoint: 0, active: true, createdAtIso: '',
  });
  const items = [mk(internalBarcode(0)), mk(internalBarcode(1))];
  assert.equal(nextBarcodeSequence(items), 2);
  const next = assignBarcode(items);
  assert.equal(next, internalBarcode(2));
  // supplier-owned codes outside the internal range never count toward the sequence
  const withGs1 = [...items, mk('5901234123457')];
  assert.equal(nextBarcodeSequence(withGs1), 2);
  // services never carry internal barcodes
  const svc = { ...mk(''), type: 'service' as const };
  assert.equal(nextBarcodeSequence([svc]), 0);
});

test('ean13Bars renders the 95-module pattern with guards', () => {
  const code = internalBarcode(42);
  const bars = ean13Bars(code);
  assert.equal(bars.length, 95);
  assert.ok(bars.startsWith('101'), 'left guard');
  assert.ok(bars.endsWith('101'), 'right guard');
  assert.equal(bars.slice(45, 50), '01010', 'middle guard');
  assert.match(bars, /^[01]+$/);
  assert.throws(() => ean13Bars('not-a-barcode'));
});

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

test('totals round to each currency ISO decimals', () => {
  assert.equal(roundMoney(10.555, 'USD'), 10.56);
  assert.equal(roundMoney(10.554, 'USD'), 10.55);
  assert.equal(roundMoney(123.5, 'JPY'), 124);
  assert.equal(roundMoney(0.005, 'BHD'), 0.005);
});

// ---------------------------------------------------------------------------
// Stock + weighted-average costing
// ---------------------------------------------------------------------------

const mov = (over: Partial<StockMovement> & { itemId: string; qty: number; at: string; warehouseId: string }): StockMovement => ({
  id: `m-${Math.random().toString(36).slice(2, 8)}`, reason: 'purchase', ...over,
});

const item = (over: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'item-1', name: 'Widget', type: 'product', sku: 'INV-0001', barcode: internalBarcode(0), category: 'Tools',
  description: '', unit: 'ea', costPrice: 5, price: 12, taxRate: 5, trackStock: true, reorderPoint: 5,
  active: true, createdAtIso: '2026-01-01T00:00:00.000Z', ...over,
});

test('weighted average cost follows purchases and survives stock-outs', () => {
  const m1 = mov({ itemId: 'item-1', qty: 10, unitCost: 5, at: '2026-01-01T00:00:00.000Z', warehouseId: 'wh-main' });
  const m2 = mov({ itemId: 'item-1', qty: 10, unitCost: 7, at: '2026-01-02T00:00:00.000Z', warehouseId: 'wh-main' });
  let c = recomputeCosting([m1, m2], 'item-1');
  assert.equal(c.qtyOnHand, 20);
  assert.equal(c.avgCost, 6);
  assert.equal(c.stockValue, 120);

  const out = mov({ itemId: 'item-1', qty: -8, at: '2026-01-03T00:00:00.000Z', warehouseId: 'wh-main' });
  c = recomputeCosting([m1, m2, out], 'item-1');
  assert.equal(c.qtyOnHand, 12);
  assert.equal(c.avgCost, 6, 'stocking out keeps the average');
  assert.equal(c.stockValue, 72);

  const drain = mov({ itemId: 'item-1', qty: -12, at: '2026-01-04T00:00:00.000Z', warehouseId: 'wh-main' });
  c = recomputeCosting([m1, m2, out, drain], 'item-1');
  assert.equal(c.qtyOnHand, 0);
  assert.equal(c.avgCost, 0, 'average resets when stock reaches zero');
  assert.equal(c.stockValue, 0);

  const restock = mov({ itemId: 'item-1', qty: 4, unitCost: 9, at: '2026-01-05T00:00:00.000Z', warehouseId: 'wh-main' });
  c = recomputeCosting([m1, m2, out, drain, restock], 'item-1');
  assert.equal(c.avgCost, 9, 'restock after a drain starts a fresh average');
});

test('stock is per warehouse; valuation sums average cost across locations', () => {
  const a = mov({ itemId: 'item-1', qty: 6, unitCost: 5, at: '2026-01-01T00:00:00.000Z', warehouseId: 'wh-a' });
  const b = mov({ itemId: 'item-1', qty: 4, unitCost: 5, at: '2026-01-01T00:00:00.000Z', warehouseId: 'wh-b' });
  assert.deepEqual(stockByWarehouse([a, b], 'item-1'), { 'wh-a': 6, 'wh-b': 4 });
  assert.equal(totalOnHand([a, b], 'item-1'), 10);

  const items = [item()];
  const v = valuation([a, b], items);
  assert.equal(v.total, 50);
  const whA = v.warehouses.find((w) => w.warehouseId === 'wh-a');
  assert.equal(whA?.stockValue, 30);
  assert.equal(whA?.itemLines, 1);
});

test('stockStatus reflects reorder points and services never track stock', () => {
  const it = item({ reorderPoint: 5 });
  assert.equal(stockStatus(it, 0), 'out');
  assert.equal(stockStatus(it, 5), 'low');
  assert.equal(stockStatus(it, 6), 'ok');
  assert.equal(stockStatus(item({ type: 'service', trackStock: false }), 0), 'n-a');
});

// ---------------------------------------------------------------------------
// POS sale math
// ---------------------------------------------------------------------------

const catalog = [
  item(),
  item({ id: 'item-2', name: 'Installation', type: 'service', trackStock: false, price: 80, taxRate: 5, barcode: '' }),
];

test('a sale totals lines with discount and tax, records COGS and change', () => {
  const opening = mov({ itemId: 'item-1', qty: 10, unitCost: 5, at: '2026-01-01T00:00:00.000Z', warehouseId: 'wh-main' });
  const r = buildPosSale({
    lines: [
      { itemId: 'item-1', qty: 2, discountPct: 10 },
      { itemId: 'item-2', qty: 1 },
    ],
    items: catalog,
    movements: [opening],
    warehouseId: 'wh-main',
    payment: 'cash',
    amountPaid: 110,
    cashier: 'Borga',
    currency: 'USD',
    id: 'sale-1',
    number: 'POS-000001',
    now: '2026-01-02T00:00:00.000Z',
  });
  assert.ok(r.ok);
  if (!r.ok) return;

  const [widget, install] = r.sale.lines;
  // Widget: 12 x 2 = 24, -10% = 21.6, +5% tax = 22.68
  assert.equal(widget.lineTotal, 22.68);
  assert.equal(widget.unitCost, 5);
  assert.equal(widget.lineCogs, 10);
  // Service: 80, no discount, 5% tax = 84
  assert.equal(install.lineTotal, 84);
  assert.equal(install.trackStock, false);

  assert.equal(r.sale.subtotal, 104);
  assert.equal(r.sale.discountTotal, 2.4);
  // tax applies to the discounted net: 21.6*5% + 80*5% = 1.08 + 4
  assert.equal(r.sale.taxTotal, 5.08);
  assert.equal(r.sale.total, 106.68);
  assert.equal(r.sale.cogsTotal, 10);
  assert.equal(r.sale.changeDue, 3.32);
  assert.equal(r.sale.status, 'completed');

  // exactly one stock-out movement, for the tracked product only
  assert.equal(r.movements.length, 1);
  assert.equal(r.movements[0].itemId, 'item-1');
  assert.equal(r.movements[0].qty, -2);
  assert.equal(r.movements[0].reference, 'POS-000001');
});

test('card and mobile sales cannot be underpaid; cash records change', () => {
  const base = {
    lines: [{ itemId: 'item-2', qty: 1 }], items: catalog, movements: [], warehouseId: 'wh-main',
    cashier: 'Borga', currency: 'USD', id: 'sale-2', number: 'POS-000002', now: '2026-01-02T00:00:00.000Z',
  };
  const card = buildPosSale({ ...base, payment: 'card' });
  assert.ok(card.ok && card.ok !== undefined);
  if (card.ok) {
    assert.equal(card.sale.amountPaid, card.sale.total);
    assert.equal(card.sale.changeDue, 0);
  }
  const cash = buildPosSale({ ...base, payment: 'cash', amountPaid: 100 });
  assert.ok(cash.ok);
  if (cash.ok) assert.equal(cash.sale.changeDue, 16);
});

test('insufficient stock and empty carts are refused, never guessed', () => {
  const opening = mov({ itemId: 'item-1', qty: 1, unitCost: 5, at: '2026-01-01T00:00:00.000Z', warehouseId: 'wh-main' });
  const short = buildPosSale({
    lines: [{ itemId: 'item-1', qty: 5 }], items: catalog, movements: [opening], warehouseId: 'wh-main',
    payment: 'cash', cashier: 'x', currency: 'USD', id: 's', number: 'POS-000003',
  });
  assert.ok(!short.ok);
  if (!short.ok && short.error === 'insufficient-stock') {
    assert.equal(short.name, 'Widget');
    assert.equal(short.available, 1);
    assert.equal(short.wanted, 5);
  } else assert.fail('expected insufficient-stock');

  const empty = buildPosSale({ lines: [], items: catalog, movements: [], warehouseId: 'wh-main', payment: 'cash', cashier: 'x', currency: 'USD', id: 's', number: 'POS-000004' });
  assert.ok(!empty.ok && empty.error === 'empty-cart');
});

test('refunds reverse the stock movements and numbers continue the sequence', () => {
  const sale: PosSale = {
    id: 'sale-1', number: 'POS-000010', warehouseId: 'wh-main',
    lines: [{ itemId: 'item-1', name: 'Widget', qty: 3, unitPrice: 12, discountPct: 0, taxRate: 5, lineSubtotal: 36, lineDiscount: 0, saleDiscount: 0, lineTax: 1.8, lineTotal: 37.8, unitCost: 5, lineCogs: 15, trackStock: true }],
    subtotal: 36, discountTotal: 0, saleDiscountPct: 0, saleDiscount: 0, taxTotal: 1.8, total: 37.8, cogsTotal: 15,
    payment: 'cash', amountPaid: 40, changeDue: 2.2, cashier: 'Borga', at: '', status: 'completed',
  };
  const back = refundMovements(sale, '2026-02-01T00:00:00.000Z');
  assert.equal(back.length, 1);
  assert.equal(back[0].qty, 3);
  assert.equal(back[0].reason, 'return');
  assert.equal(back[0].unitCost, 5, 'returns restock at the sale-time cost');

  assert.equal(nextPosNumber([]), 'POS-000001');
  assert.equal(nextPosNumber([{ ...sale, number: 'POS-000041' }, { ...sale, number: 'POS-000007' }]), 'POS-000042');
});

test('a sale-level discount applies across the cart after line discounts, before tax', () => {
  const opening = mov({ itemId: 'item-1', qty: 10, unitCost: 5, at: '2026-01-01T00:00:00.000Z', warehouseId: 'wh-main' });
  const r = buildPosSale({
    lines: [
      { itemId: 'item-1', qty: 2, discountPct: 10 },   // 24 -> 21.6 net
      { itemId: 'item-2', qty: 1 },                    // 80 net (service)
    ],
    items: catalog,
    movements: [opening],
    warehouseId: 'wh-main',
    payment: 'card',
    saleDiscountPct: 10,
    cashier: 'Borga',
    currency: 'USD',
    id: 'sale-d',
    number: 'POS-000050',
    now: '2026-01-02T00:00:00.000Z',
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  // net cart: 101.60 -> sale discount 10.16, split 21.6/80 proportionally (2.16 + 8.00)
  assert.equal(r.sale.saleDiscountPct, 10);
  assert.equal(r.sale.saleDiscount, 10.16);
  assert.equal(r.sale.lines[0].saleDiscount, 2.16);
  assert.equal(r.sale.lines[1].saleDiscount, 8);
  // tax lands on the fully discounted net: (19.44 + 72) * 5% = 4.572 -> 4.57
  assert.equal(r.sale.taxTotal, 4.57);
  assert.equal(r.sale.total, roundMoney(104 - 2.4 - 10.16 + 4.57, 'USD'));
  // the whole cart discounted to zero owes nothing and taxes nothing
  const free = buildPosSale({
    lines: [{ itemId: 'item-2', qty: 1 }], items: catalog, movements: [], warehouseId: 'wh-main',
    payment: 'card', saleDiscountPct: 100, cashier: 'x', currency: 'USD', id: 'sale-z', number: 'POS-000051',
  });
  assert.ok(free.ok);
  if (free.ok) {
    assert.equal(free.sale.total, 0);
    assert.equal(free.sale.taxTotal, 0);
  }
});

test('sales carry the linked customer and walk-ins stay walk-ins', () => {
  const opening = mov({ itemId: 'item-1', qty: 10, unitCost: 5, at: '2026-01-01T00:00:00.000Z', warehouseId: 'wh-main' });
  const linked = buildPosSale({
    lines: [{ itemId: 'item-2', qty: 1 }], items: catalog, movements: [opening], warehouseId: 'wh-main',
    payment: 'card', cashier: 'Borga', currency: 'USD', id: 'sale-c', number: 'POS-000060',
    customerId: 'cust-7', customerName: 'Acme Corp',
  });
  assert.ok(linked.ok);
  if (linked.ok) {
    assert.equal(linked.sale.customerId, 'cust-7');
    assert.equal(linked.sale.customerName, 'Acme Corp');
  }
  const anon = buildPosSale({
    lines: [{ itemId: 'item-2', qty: 1 }], items: catalog, movements: [opening], warehouseId: 'wh-main',
    payment: 'card', cashier: 'Borga', currency: 'USD', id: 'sale-w', number: 'POS-000061',
  });
  assert.ok(anon.ok);
  if (anon.ok) {
    assert.equal(anon.sale.customerId, null);
    assert.equal(anon.sale.customerName, undefined);
  }
});

// ---------------------------------------------------------------------------
// Ledger + journals — POS posts like an invoice settlement
// ---------------------------------------------------------------------------

const coa: GlAccount[] = INITIAL_COA;
const sale: PosSale = {
  id: 'sale-fin', number: 'POS-000100', warehouseId: 'wh-main',
  lines: [
    { itemId: 'item-1', name: 'Widget', qty: 2, unitPrice: 12, discountPct: 0, taxRate: 5, lineSubtotal: 24, lineDiscount: 0, saleDiscount: 0, lineTax: 1.2, lineTotal: 25.2, unitCost: 5, lineCogs: 10, trackStock: true },
    { itemId: 'item-2', name: 'Install', qty: 1, unitPrice: 80, discountPct: 0, taxRate: 5, lineSubtotal: 80, lineDiscount: 0, saleDiscount: 0, lineTax: 4, lineTotal: 84, unitCost: 0, lineCogs: 0, trackStock: false },
  ],
  subtotal: 104, discountTotal: 0, saleDiscountPct: 0, saleDiscount: 0, taxTotal: 5.2, total: 109.2, cogsTotal: 10,
  payment: 'cash', amountPaid: 110, changeDue: 0.8, cashier: 'Register', customerId: 'cust-7', customerName: 'Acme Corp',
  at: '2026-10-03T12:00:00.000Z', status: 'completed',
};

test('POS ledger entries post revenue and COGS with the audit trail', () => {
  const now = '2026-10-03T12:00:01.000Z';
  const fin = saleFinanceEntries(sale, now);
  assert.equal(fin.length, 2);
  assert.equal(fin[0].kind, 'revenue');
  assert.equal(fin[0].amount, 109.2);
  assert.equal(fin[0].category, 'Point of Sale');
  assert.equal(fin[0].externalRef, 'POS-000100');
  assert.equal(fin[0].source, 'auto');
  assert.ok(fin[0].label.includes('Acme Corp'));
  assert.equal(fin[1].kind, 'expense');
  assert.equal(fin[1].amount, 10);
  assert.equal(fin[1].category, 'Cost of Goods Sold');

  const refunds = refundFinanceEntries(sale, now);
  assert.equal(refunds.length, 2);
  assert.equal(refunds[0].amount, -109.2, 'refund reverses revenue with a negative amount');
  assert.ok(refunds[0].label.startsWith('Reversal'));
  assert.equal(refunds[1].amount, -10);

  assert.equal(ledgerPaymentMethod('cash'), 'cash');
  assert.equal(ledgerPaymentMethod('mobile'), 'mobile-wallet');
  assert.equal(ledgerPaymentMethod('card'), undefined);
});

test('POS journals balance: cash in, revenue split by line type, tax payable, COGS relieves inventory', () => {
  const now = '2026-10-03T12:00:01.000Z';
  const jes = saleJournals(sale, coa, now);
  assert.equal(jes.length, 2);

  const settle = jes[0];
  type JLines = JournalEntry['lines'];
  const sum = (lines: JLines) => lines.reduce((n, l) => n + l.debit, 0);
  const sumCr = (lines: JLines) => lines.reduce((n, l) => n + l.credit, 0);
  assert.equal(Math.round(sum(settle.lines) * 100) / 100, Math.round(sumCr(settle.lines) * 100) / 100, 'debits equal credits');
  assert.ok(settle.lines.some((l) => l.accountId === 'gl-1000' && l.debit === 109.2), 'cash debited for the total');
  assert.ok(settle.lines.some((l) => l.accountId === 'gl-4000' && l.credit === 24), 'product net to Sales Revenue');
  assert.ok(settle.lines.some((l) => l.accountId === 'gl-4100' && l.credit === 80), 'service net to Service Revenue');
  assert.ok(settle.lines.some((l) => l.accountId === 'gl-2200' && l.credit === 5.2), 'tax to Sales Tax Payable');
  assert.equal(settle.auto, 'pos');

  const cogs = jes[1];
  assert.ok(cogs.lines.some((l) => l.accountId === 'gl-4200' && l.debit === 10), 'COGS debited');
  assert.ok(cogs.lines.some((l) => l.accountId === 'gl-1300' && l.credit === 10), 'Inventory relieved');

  // Refunds mirror the postings line for line.
  const rj = refundJournals(sale, coa, now);
  assert.equal(rj.length, 2);
  for (let i = 0; i < 2; i++) {
    assert.equal(rj[i].id, `${jes[i].id}-refund`);
    assert.deepEqual(
      rj[i].lines.map((l) => [l.accountId, l.debit, l.credit]),
      jes[i].lines.map((l) => [l.accountId, l.credit, l.debit]),
      'refund journals swap debit and credit',
    );
  }
});

test('journals skip cleanly when the chart of accounts lacks the accounts', () => {
  const bare: GlAccount[] = [{ id: 'gl-1000', code: '1000', name: 'Cash & Bank', type: 'asset', isCash: true }];
  const jes = saleJournals(sale, bare, '2026-10-03T12:00:01.000Z');
  assert.equal(jes.length, 0, 'no revenue/COGS accounts means no journals, no guessing');
  assert.equal(saleJournals(sale, [], '2026-10-03T12:00:01.000Z').length, 0);
});

// ---------------------------------------------------------------------------
// Descriptions + service alignment
// ---------------------------------------------------------------------------

test('the fallback description is factual, never fake', () => {
  const p = templateDescription(item({ name: 'Cordless Drill' }), 'USD', '$');
  assert.match(p, /Cordless Drill/);
  assert.match(p, /\$12\.00/);
  assert.ok(p.length > 60);
  const s = templateDescription(item({ name: 'Consulting', type: 'service' }), 'USD', '$');
  assert.match(s, /service/i);
});

test('the AI prompt carries the facts and tight output rules', () => {
  const prompt = descriptionPrompt(item(), 'Acme Ltd', 'USD');
  assert.match(prompt, /Widget/);
  assert.match(prompt, /Acme Ltd/);
  assert.match(prompt, /No markdown/);
});

test('service items are derived from the revenue tracks once, deduped', () => {
  const tracks = [
    { lines: [{ service: 'Same-day delivery' }, { service: 'Freight' }] },
    { lines: [{ service: 'same-day delivery' }, { name: 'Moving' }] },
  ];
  const items = serviceItemsFromTracks(tracks);
  assert.equal(items.length, 3);
  assert.ok(items.every((i) => i.type === 'service' && !i.trackStock && !i.barcode));
  assert.ok(items.some((i) => i.name === 'Same-day delivery'));
});
