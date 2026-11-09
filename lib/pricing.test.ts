import assert from 'node:assert/strict';
import test from 'node:test';
import { documentTotals, linesSubtotal, normalizeBill, normalizeInvoice, normalizeMoneyEntity, normalizePosSale } from './borga/pricing';
import type { Bill, Invoice } from './borga/data';

const line = (qty: number, unitPrice: number) => ({ id: 'l1', description: 'Item', qty, unitPrice });
const invoice = (over: Partial<Invoice>): Invoice =>
  ({ id: 'inv-1', number: 'INV-1', client: 'Acme', amount: 0, status: 'draft', issued: '2026-01-01', due: '2026-02-01', ...over }) as Invoice;

test('line subtotal sums quantity x unit price', () => {
  assert.equal(linesSubtotal([line(2, 10), line(3, 2.5)]), 27.5);
});

test('a discount is capped at the subtotal so a document can never go negative', () => {
  const t = documentTotals([line(1, 100)], { discountAmount: 250 });
  assert.equal(t.discount, 100);
  assert.equal(t.total, 0);
});

test('tax applies to the discounted subtotal', () => {
  const t = documentTotals([line(1, 100)], { discountAmount: 10, taxRate: 15 });
  assert.deepEqual(t, { subtotal: 100, discount: 10, tax: 13.5, total: 103.5 });
});

test('a forged client total is replaced by the line arithmetic', () => {
  const inv = invoice({ lines: [line(2, 50)], amount: 1 });
  assert.equal(normalizeInvoice(inv).amount, 100);
});

test('foreign currency converts at the document fx rate and keeps the face value', () => {
  const inv = invoice({ lines: [line(1, 100)], currency: 'EUR', fxRate: 1.5, amount: 1 });
  const out = normalizeInvoice(inv);
  assert.equal(out.amount, 150);
  assert.equal(out.foreignAmount, 100);
});

test('a foreign document with no fx rate keeps its stored amount instead of guessing', () => {
  const inv = invoice({ lines: [line(1, 100)], currency: 'EUR', amount: 7 });
  assert.equal(normalizeInvoice(inv).amount, 7);
});

test('a legacy invoice without lines keeps its hand-entered amount', () => {
  const inv = invoice({ amount: 42 });
  assert.equal(normalizeInvoice(inv).amount, 42);
});

test('bills use the same rules', () => {
  const bill = { id: 'b1', vendor: 'V', amount: 1, lines: [line(3, 10)], status: 'draft' } as unknown as Bill;
  assert.equal(normalizeBill(bill).amount, 30);
});

test('POS receipts are rebuilt from their line inputs', () => {
  const sale = {
    subtotal: 1,
    total: 1,
    saleDiscountPct: 10,
    lines: [{ qty: 1, unitPrice: 100, discountPct: 0, taxRate: 10 }],
  };
  const out = normalizePosSale(sale);
  assert.equal(out.subtotal, 100);
  assert.equal(out.saleDiscount, 10);
  assert.equal(out.taxTotal, 9);
  assert.equal(out.total, 99);
});

test('normalizeMoneyEntity only touches money lists', () => {
  assert.deepEqual(normalizeMoneyEntity('customers', [{ amount: 5 }]), [{ amount: 5 }]);
  const out = normalizeMoneyEntity('invoices', [invoice({ lines: [line(1, 20)], amount: 999 })]) as Invoice[];
  assert.equal(out[0].amount, 20);
});
