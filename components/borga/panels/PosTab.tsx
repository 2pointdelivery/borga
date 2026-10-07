'use client';

import { useMemo, useState } from 'react';
import {
  Search, Plus, Minus, Trash2, ShoppingCart, Banknote, CreditCard, Smartphone,
  Receipt, RotateCcw, ScanLine, CheckCircle2, UserRound, TrendingUp,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBorga } from '@/lib/borga/store';
import { fmtMoney } from '@/lib/borga/currencies';
import {
  buildPosSale, nextPosNumber, stockByWarehouse, totalOnHand, saleFinanceEntries, saleJournals,
  type CartInput, type PaymentMethod, type PosSale,
} from '@/lib/borga/inventory';
import { toast } from '@/lib/toast-bus';
import { SectionTitle } from '../bits';
import { SearchSelect } from '../SearchSelect';
import { ConfirmDialog } from '../ConfirmDialog';
import { cn } from '@/lib/utils';

const PAYMENT_ICON: Record<PaymentMethod, React.FC<{ className?: string }>> = {
  cash: ({ className }) => <Banknote className={className} />,
  card: ({ className }) => <CreditCard className={className} />,
  mobile: ({ className }) => <Smartphone className={className} />,
};

/** Id generation lives outside the component so handlers stay pure from the linter's point of view. */
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const WALK_IN = 'walk-in';

export function PosTab() {
  const {
    inventoryItems, warehouses, stockMovements, recordStockMovement, posSales, addPosSale, refundPosSale,
    customers, coa, addFinanceEntry, addJournalEntry, addTask, activeWorkspace, log,
  } = useBorga();
  const currency = activeWorkspace()?.currency ?? 'USD';
  const money = (n: number) => fmtMoney(n, currency);
  const cashier = 'Register'; // per-operator till tracking is a follow-up

  const activeWhs = warehouses.filter((w) => w.active);
  const [warehouseId, setWarehouseId] = useState(activeWhs.find((w) => w.kind === 'store')?.id ?? activeWhs[0]?.id ?? '');
  const sellable = useMemo(() => inventoryItems.filter((i) => i.active), [inventoryItems]);
  const categories = useMemo(() => [...new Set(sellable.map((i) => i.category).filter(Boolean))].sort(), [sellable]);

  const [cart, setCart] = useState<CartInput[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [scan, setScan] = useState('');
  const [payment, setPayment] = useState<PaymentMethod>('cash');
  const [amountPaid, setAmountPaid] = useState('');
  const [customerId, setCustomerId] = useState<string>(WALK_IN);
  const [saleDiscountPct, setSaleDiscountPct] = useState('');
  const [receipt, setReceipt] = useState<PosSale | null>(null);
  const [confirmRefund, setConfirmRefund] = useState<PosSale | null>(null);

  const stockAt = (itemId: string) => (warehouseId ? stockByWarehouse(stockMovements, itemId)[warehouseId] ?? 0 : totalOnHand(stockMovements, itemId));
  const customer = customers.find((c) => c.id === customerId);
  const customerStats = useMemo(() => {
    if (!customer) return null;
    const mine = posSales.filter((s) => s.customerId === customer.id && s.status === 'completed');
    return { count: mine.length, spend: mine.reduce((n, s) => n + s.total, 0) };
  }, [customer, posSales]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sellable
      .filter((i) => (category === 'all' || i.category === category) && (!q || `${i.name} ${i.sku} ${i.barcode}`.toLowerCase().includes(q)))
      .slice(0, 30);
  }, [sellable, query, category]);

  const addToCart = (itemId: string, qty = 1) => {
    setCart((c) => {
      const existing = c.find((l) => l.itemId === itemId);
      return existing
        ? c.map((l) => (l.itemId === itemId ? { ...l, qty: l.qty + qty } : l))
        : [...c, { itemId, qty }];
    });
  };

  const scanEnter = () => {
    const code = scan.trim();
    if (!code) return;
    const hit = sellable.find((i) => i.barcode === code || i.sku.toLowerCase() === code.toLowerCase());
    if (hit) {
      addToCart(hit.id);
      setScan('');
    } else {
      toast({ title: 'No item matches this code', variant: 'error' });
    }
  };

  const setQty = (itemId: string, qty: number) => {
    setCart((c) => (qty <= 0 ? c.filter((l) => l.itemId !== itemId) : c.map((l) => (l.itemId === itemId ? { ...l, qty } : l))));
  };
  const setDiscount = (itemId: string, discountPct: number) => {
    setCart((c) => c.map((l) => (l.itemId === itemId ? { ...l, discountPct: Math.max(0, Math.min(100, discountPct)) } : l)));
  };

  const saleInput = (id: string, number: string) => ({
    lines: cart,
    items: inventoryItems,
    movements: stockMovements,
    warehouseId,
    payment,
    amountPaid: amountPaid ? Number(amountPaid) : undefined,
    saleDiscountPct: Number(saleDiscountPct) || 0,
    cashier,
    currency,
    customerId: customer?.id ?? null,
    customerName: customer?.name ?? undefined,
    id,
    number,
  });

  const preview = useMemo(() => {
    if (!cart.length || !warehouseId) return null;
    return buildPosSale(saleInput('preview', 'PREVIEW'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, inventoryItems, stockMovements, warehouseId, payment, amountPaid, saleDiscountPct, customerId, customers, currency]);

  const complete = () => {
    if (!cart.length || !warehouseId) return;
    const number = nextPosNumber(posSales);
    const r = buildPosSale(saleInput(uid('sale'), number));
    if (!r.ok) {
      if (r.error === 'insufficient-stock') toast({ title: `Not enough stock: ${r.name}`, description: `${r.available} available at this location, ${r.wanted} wanted.`, variant: 'error' });
      else if (r.error === 'underpaid') toast({ title: `Still owed ${money(r.total - r.paid)}`, variant: 'error' });
      else toast({ title: 'Cart is empty', variant: 'error' });
      return;
    }
    const now = new Date().toISOString();
    addPosSale(r.sale);
    for (const m of r.movements) recordStockMovement(m);
    // Finance + double-entry journals — same posting pattern as invoice settlements.
    const fin = saleFinanceEntries(r.sale, now);
    for (const f of fin) addFinanceEntry(f);
    const jes = saleJournals(r.sale, coa, now);
    for (const je of jes) addJournalEntry(je);
    log({
      agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'task',
      message: `POS: ${number} completed — ${money(r.sale.total)} (${r.sale.payment}) for ${r.sale.customerName ?? 'a walk-in'}, COGS ${money(r.sale.cogsTotal)}, posted ${fin.length} ledger entr${fin.length !== 1 ? 'ies' : 'y'} and ${jes.length} journal${jes.length !== 1 ? 's' : ''}.`,
    });
    const lowLines = r.sale.lines.filter((l) => l.trackStock && ['low', 'out'].includes(stockStatusOf(l.itemId)));
    if (lowLines.length) {
      addTask({
        id: uid('t'), title: `Reorder after ${number}: ${lowLines.map((l) => l.name).join(', ')}`,
        detail: 'Stock ran low or out at the register. Review reorder points and receive stock.',
        priority: 'P1', status: 'todo', bucket: 'week', assignee: 'Borga',
        tags: ['inventory', 'reorder'], due: 'This week', progress: 0,
      });
    }
    setReceipt(r.sale);
    setCart([]);
    setAmountPaid('');
    setSaleDiscountPct('');
  };

  const total = preview?.ok ? preview.sale.total : 0;

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Point of Sale" sub="Scan or tap items, take payment, move stock — every sale posts to the ledger, journals and the customer's history." />
        <div className="w-48">
          <Select value={warehouseId} onValueChange={setWarehouseId}>
            <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Location" /></SelectTrigger>
            <SelectContent>
              {activeWhs.map((w) => <SelectItem key={w.id} value={w.id}>{w.name} ({w.kind})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* Item grid */}
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, SKU, barcode…" className="h-9 pl-8 text-sm" />
            </div>
            <div className="relative w-52">
              <ScanLine className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-primary" />
              <Input
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') scanEnter(); }}
                placeholder="Scan barcode / SKU + Enter"
                className="h-9 pl-8 font-mono text-sm"
              />
            </div>
          </div>
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setCategory('all')}
                className={cn('rounded-full border px-2.5 py-1 text-xs font-medium transition-colors', category === 'all' ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:border-primary hover:text-primary')}
              >
                All
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={cn('rounded-full border px-2.5 py-1 text-xs font-medium transition-colors', category === c ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:border-primary hover:text-primary')}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
          <div className="grid max-h-[420px] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3 xl:grid-cols-4">
            {filtered.map((i) => {
              const onHand = stockAt(i.id);
              const out = i.trackStock && onHand <= 0;
              return (
                <button
                  key={i.id}
                  onClick={() => addToCart(i.id)}
                  disabled={out}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-xl border bg-card p-3 text-left transition-colors',
                    out ? 'opacity-50' : 'hover:border-primary hover:bg-accent',
                  )}
                >
                  <p className="line-clamp-2 min-h-[2rem] text-xs font-medium leading-tight">{i.name}</p>
                  <span className="text-sm font-semibold">{money(i.price)}</span>
                  <span className={cn('text-[10px]', i.trackStock ? (out ? 'text-rose-600' : 'text-muted-foreground') : 'text-muted-foreground')}>
                    {i.trackStock ? `${onHand} in stock` : 'service'}
                  </span>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="col-span-full rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No sellable items match. Add items in the Catalog first.
              </p>
            )}
          </div>
        </div>

        {/* Cart */}
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Cart</h3>
            <Badge variant="secondary">{(() => { const n = cart.reduce((x, l) => x + l.qty, 0); return `${n} item${n !== 1 ? 's' : ''}`; })()}</Badge>
          </div>

          {/* Customer */}
          <div>
            <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><UserRound className="h-3 w-3" /> Customer</label>
            <SearchSelect
              options={[
                { value: WALK_IN, label: 'Walk-in (no account)' },
                ...customers.map((c) => ({ value: c.id, label: c.name, detail: c.industry || c.status })),
              ]}
              value={customerId}
              onChange={setCustomerId}
              placeholder="Walk-in (no account)"
              searchPlaceholder="Search customers"
              clearable={false}
              className="mt-1 h-8 text-sm"
            />
            {customerStats && customer && (
              <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                <TrendingUp className="h-3 w-3" /> {customerStats.count} previous sale{customerStats.count !== 1 ? 's' : ''} · {money(customerStats.spend)} lifetime at this register
              </p>
            )}
          </div>

          <div className="flex-1 space-y-2">
            {cart.map((l) => {
              const item = inventoryItems.find((i) => i.id === l.itemId);
              if (!item) return null;
              return (
                <div key={l.itemId} className="rounded-lg border p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{item.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {money(item.price)} / {item.unit}{item.taxRate ? ` · tax ${item.taxRate}%` : ' · no tax'}{item.trackStock ? ` · ${stockAt(item.id)} here` : ' · service'}
                      </p>
                    </div>
                    <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-rose-500" onClick={() => setQty(l.itemId, 0)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="outline" className="h-6 w-6" onClick={() => setQty(l.itemId, l.qty - 1)}><Minus className="h-3 w-3" /></Button>
                      <span className="w-8 text-center text-sm font-semibold">{l.qty}</span>
                      <Button size="icon" variant="outline" className="h-6 w-6" onClick={() => setQty(l.itemId, l.qty + 1)}><Plus className="h-3 w-3" /></Button>
                    </div>
                    <div className="flex items-center gap-1">
                      <Input
                        className="h-6 w-14 text-right text-xs"
                        type="number" min="0" max="100"
                        value={l.discountPct ?? 0}
                        onChange={(e) => setDiscount(l.itemId, Number(e.target.value) || 0)}
                        title="Line discount %"
                      />
                      <span className="text-[10px] text-muted-foreground">% off</span>
                    </div>
                  </div>
                </div>
              );
            })}
            {cart.length === 0 && (
              <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                Tap items or scan a barcode to start a sale.
              </p>
            )}
          </div>

          {/* Sale-level discount */}
          <div className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
            <span className="text-xs font-medium text-muted-foreground">Sale discount</span>
            <div className="flex items-center gap-1">
              <Input
                className="h-7 w-16 text-right text-xs"
                type="number" min="0" max="100" step="0.5"
                value={saleDiscountPct}
                onChange={(e) => setSaleDiscountPct(e.target.value)}
                placeholder="0"
              />
              <span className="text-[10px] text-muted-foreground">% off the whole cart</span>
            </div>
          </div>

          {preview?.ok && (
            <div className="space-y-1 rounded-lg bg-muted/40 p-3 text-xs">
              <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>{money(preview.sale.subtotal)}</span></div>
              {preview.sale.discountTotal > 0 && <div className="flex justify-between text-muted-foreground"><span>Line discounts</span><span>−{money(preview.sale.discountTotal)}</span></div>}
              {preview.sale.saleDiscount > 0 && <div className="flex justify-between text-muted-foreground"><span>Sale discount ({preview.sale.saleDiscountPct}%)</span><span>−{money(preview.sale.saleDiscount)}</span></div>}
              <div className="flex justify-between text-muted-foreground"><span>Tax</span><span>{money(preview.sale.taxTotal)}</span></div>
              <div className="flex justify-between border-t pt-1.5 text-sm font-semibold"><span>Total</span><span>{money(preview.sale.total)}</span></div>
              {preview.sale.cogsTotal > 0 && <div className="text-[10px] text-muted-foreground">COGS {money(preview.sale.cogsTotal)} · posts to the ledger on completion</div>}
            </div>
          )}
          {!preview?.ok && preview && preview.error === 'insufficient-stock' && (
            <p className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-2 text-[11px] text-rose-600">
              Not enough stock for {preview.name}: {preview.available} here, {preview.wanted} in the cart.
            </p>
          )}
          {!preview?.ok && preview && preview.error === 'underpaid' && (
            <p className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-2 text-[11px] text-rose-600">
              Still owed {money(preview.total - preview.paid)}.
            </p>
          )}

          <div className="flex gap-2">
            {(Object.keys(PAYMENT_ICON) as PaymentMethod[]).map((p) => {
              const Icon = PAYMENT_ICON[p];
              return (
                <button
                  key={p}
                  onClick={() => setPayment(p)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium capitalize transition-colors',
                    payment === p ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:border-primary',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" /> {p}
                </button>
              );
            })}
          </div>

          {payment === 'cash' && (
            <div className="flex items-center gap-2">
              <Input
                type="number" min="0" step="0.01"
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
                placeholder={`Amount received (${money(total || 0)})`}
                className="h-9 text-sm"
              />
              {preview?.ok && preview.sale.changeDue > 0 && (
                <Badge className="shrink-0 bg-emerald-500/10 text-emerald-600">Change {money(preview.sale.changeDue)}</Badge>
              )}
            </div>
          )}

          <Button className="w-full gap-1.5" size="lg" onClick={complete} disabled={!cart.length || !preview?.ok}>
            <CheckCircle2 className="h-4 w-4" /> Complete sale · {money(total)}
          </Button>
        </Card>
      </div>

      {/* Recent sales */}
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Receipt className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Recent sales</h3>
          <Badge variant="secondary">{posSales.length}</Badge>
        </div>
        <div className="space-y-2">
          {posSales.slice(0, 10).map((s) => {
            const wh = warehouses.find((w) => w.id === s.warehouseId);
            const PaymentIcon = PAYMENT_ICON[s.payment];
            const cust = customers.find((c) => c.id === s.customerId);
            return (
              <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5 text-xs">
                <span className="font-mono font-medium">{s.number}</span>
                <span className="text-muted-foreground">{new Date(s.at).toLocaleString()}</span>
                <Badge variant="outline" className="gap-1 text-[10px] capitalize"><PaymentIcon className="h-3 w-3" />{s.payment}</Badge>
                <span className="flex items-center gap-1 text-muted-foreground"><UserRound className="h-3 w-3" />{cust?.name ?? s.customerName ?? 'Walk-in'}</span>
                <span className="text-muted-foreground">{s.lines.length} line{s.lines.length !== 1 ? 's' : ''} · {wh?.name ?? '—'}</span>
                <span className="ml-auto font-semibold">{money(s.total)}</span>
                <Badge className={cn('text-[10px]', s.status === 'refunded' ? 'bg-rose-500/10 text-rose-600' : 'bg-emerald-500/10 text-emerald-600')}>{s.status}</Badge>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setReceipt(s)}>Receipt</Button>
                {s.status === 'completed' && (
                  <Button
                    size="sm" variant="ghost"
                    className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-rose-500"
                    onClick={() => setConfirmRefund(s)}
                  >
                    <RotateCcw className="h-3 w-3" /> Refund
                  </Button>
                )}
              </div>
            );
          })}
          {posSales.length === 0 && (
            <p className="p-4 text-center text-xs text-muted-foreground">No sales yet — the first completed sale shows up here with its receipt.</p>
          )}
        </div>
      </Card>

      {/* Receipt */}
      <Dialog open={!!receipt} onOpenChange={(o) => { if (!o) setReceipt(null); }}>
        <DialogContent className="sm:max-w-sm">
          {receipt && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 font-mono"><Receipt className="h-4 w-4" /> {receipt.number}</DialogTitle>
              </DialogHeader>
              <div className="space-y-2 font-mono text-xs">
                <p className="text-muted-foreground">{activeWorkspace()?.name ?? 'Store'} · {warehouses.find((w) => w.id === receipt.warehouseId)?.name}</p>
                <p className="text-muted-foreground">{new Date(receipt.at).toLocaleString()} · {receipt.cashier}</p>
                <p className="flex items-center gap-1 text-muted-foreground"><UserRound className="h-3 w-3" />{receipt.customerName ?? 'Walk-in'}</p>
                <div className="space-y-1 border-t pt-2">
                  {receipt.lines.map((l, idx) => (
                    <div key={idx} className="flex justify-between gap-2">
                      <span className="min-w-0 truncate">{l.qty}× {l.name}{l.discountPct ? ` (−${l.discountPct}%)` : ''}</span>
                      <span>{fmtMoney(l.lineTotal, currency)}</span>
                    </div>
                  ))}
                </div>
                <div className="space-y-0.5 border-t pt-2">
                  <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>{fmtMoney(receipt.subtotal, currency)}</span></div>
                  {receipt.discountTotal > 0 && <div className="flex justify-between text-muted-foreground"><span>Line discounts</span><span>−{fmtMoney(receipt.discountTotal, currency)}</span></div>}
                  {(receipt.saleDiscount ?? 0) > 0 && <div className="flex justify-between text-muted-foreground"><span>Sale discount ({receipt.saleDiscountPct ?? 0}%)</span><span>−{fmtMoney(receipt.saleDiscount ?? 0, currency)}</span></div>}
                  <div className="flex justify-between text-muted-foreground"><span>Tax</span><span>{fmtMoney(receipt.taxTotal, currency)}</span></div>
                  <div className="flex justify-between text-sm font-semibold"><span>Total</span><span>{fmtMoney(receipt.total, currency)}</span></div>
                  <div className="flex justify-between text-muted-foreground capitalize"><span>{receipt.payment}</span><span>{fmtMoney(receipt.amountPaid, currency)}</span></div>
                  {receipt.changeDue > 0 && <div className="flex justify-between text-muted-foreground"><span>Change</span><span>{fmtMoney(receipt.changeDue, currency)}</span></div>}
                </div>
                {receipt.status === 'refunded' && <Badge className="bg-rose-500/10 text-rose-600">refunded</Badge>}
                <p className="text-center text-[10px] text-muted-foreground">Posted to the ledger{receipt.cogsTotal > 0 ? ' with COGS' : ''}. Thank you.</p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmRefund}
        onOpenChange={(o) => { if (!o) setConfirmRefund(null); }}
        title={`Refund ${confirmRefund?.number ?? 'sale'}?`}
        description={confirmRefund ? `${money(confirmRefund.total)} goes back to ${confirmRefund.customerName ?? 'the walk-in'}. Stock is restocked and the ledger entries plus journals are reversed.` : ''}
        confirmLabel="Refund sale"
        onConfirm={() => {
          if (!confirmRefund) return;
          refundPosSale(confirmRefund.id);
          log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'task', message: `POS: refunded ${confirmRefund.number} — ${money(confirmRefund.total)} returned, stock restocked, ledger reversed.` });
          setConfirmRefund(null);
        }}
      />
    </div>
  );

  function stockStatusOf(itemId: string): 'ok' | 'low' | 'out' | 'n-a' {
    const item = inventoryItems.find((i) => i.id === itemId);
    if (!item || !item.trackStock) return 'n-a';
    const onHand = totalOnHand(stockMovements, item.id);
    if (onHand <= 0) return 'out';
    if (onHand <= item.reorderPoint) return 'low';
    return 'ok';
  }
}
