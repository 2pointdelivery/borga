'use client';

import { useMemo, useState } from 'react';
import { PackagePlus, SlidersHorizontal, History, TrendingUp, AlertTriangle, PackageX, Search } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBorga } from '@/lib/borga/store';
import { fmtMoney } from '@/lib/borga/currencies';
import {
  recomputeCosting, stockByWarehouse, totalOnHand, stockStatus, valuation,
  type InventoryItem, type StockMovement, type MovementReason,
} from '@/lib/borga/inventory';
import { toast } from '@/lib/toast-bus';
import { SectionTitle } from '../bits';
import { cn } from '@/lib/utils';

/** Id generation lives outside the component so handlers stay pure from the linter's point of view. */
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const REASON_STYLE: Record<MovementReason, string> = {
  purchase: 'bg-emerald-500/10 text-emerald-600',
  sale: 'bg-sky-500/10 text-sky-600',
  adjustment: 'bg-amber-500/10 text-amber-600',
  'transfer-in': 'bg-violet-500/10 text-violet-600',
  'transfer-out': 'bg-violet-500/10 text-violet-600',
  return: 'bg-rose-500/10 text-rose-600',
};

export function InventoryStockTab() {
  const { inventoryItems, warehouses, stockMovements, recordStockMovement, vendors, addTask, activeWorkspace, log } = useBorga();
  const currency = activeWorkspace()?.currency ?? 'USD';
  const money = (n: number) => fmtMoney(n, currency);

  const [showReceive, setShowReceive] = useState<InventoryItem | null>(null);
  const [movementQuery, setMovementQuery] = useState('');
  const [receive, setReceive] = useState({ warehouseId: '', qty: '', unitCost: '', note: '' });
  const [showAdjust, setShowAdjust] = useState<InventoryItem | null>(null);
  const [adjust, setAdjust] = useState({ warehouseId: '', qty: '', note: '' });

  const products = useMemo(() => inventoryItems.filter((i) => i.type === 'product' && i.trackStock), [inventoryItems]);
  const activeWarehouses = warehouses.filter((w) => w.active);
  const whName = (id: string) => warehouses.find((w) => w.id === id)?.name ?? id;
  const vendorName = (id?: string) => vendors.find((v) => v.id === id)?.name;

  /** A reorder task links the stock ledger to the team's task board (and the agent fleet that works it). */
  const createReorderTask = (item: InventoryItem) => {
    const onHand = totalOnHand(stockMovements, item.id);
    const supplier = vendorName(item.supplierId);
    addTask({
      id: uid('t'),
      title: `Reorder "${item.name}" — ${onHand} left`,
      detail: [
        `On hand: ${onHand} (reorder point ${item.reorderPoint}).`,
        item.sku ? `SKU ${item.sku}${item.barcode ? ` · barcode ${item.barcode}` : ''}.` : '',
        supplier ? `Preferred supplier: ${supplier}.` : '',
        'Receive the replacement stock under Stock & Costing once it arrives.',
      ].filter(Boolean).join(' '),
      priority: onHand <= 0 ? 'P0' : 'P1',
      status: 'todo',
      bucket: onHand <= 0 ? 'today' : 'week',
      assignee: 'Borga',
      tags: ['inventory', 'reorder'],
      due: onHand <= 0 ? 'Today' : 'This week',
      progress: 0,
    });
    log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'task', message: `Reorder task created for "${item.name}" — ${onHand} on hand${supplier ? `, supplier ${supplier}` : ''}.` });
    toast({ title: 'Reorder task created', description: 'It is on the task board for the team and the agents.', variant: 'success' });
  };

  const value = useMemo(() => valuation(stockMovements, inventoryItems, activeWarehouses.map((w) => w.id)), [stockMovements, inventoryItems, activeWarehouses]);
  const lowStock = products.filter((p) => {
    const s = stockStatus(p, totalOnHand(stockMovements, p.id));
    return s === 'low' || s === 'out';
  });

  const doReceive = () => {
    const item = showReceive;
    const qty = Math.max(0, Number(receive.qty) || 0);
    const unitCost = Math.max(0, Number(receive.unitCost) || 0);
    if (!item || !qty || !receive.warehouseId) return;
    const m: StockMovement = {
      id: uid('mov-in'),
      itemId: item.id,
      warehouseId: receive.warehouseId,
      qty,
      unitCost,
      reason: 'purchase',
      note: receive.note.trim() || undefined,
      at: new Date().toISOString(),
    };
    recordStockMovement(m);
    log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'task', message: `Stock: received ${qty} × "${item.name}" into ${whName(receive.warehouseId)} at ${money(unitCost)}.` });
    setShowReceive(null);
    setReceive({ warehouseId: '', qty: '', unitCost: '', note: '' });
  };

  const doAdjust = () => {
    const item = showAdjust;
    const qty = Number(adjust.qty) || 0;
    if (!item || !qty || !adjust.warehouseId) return;
    const m: StockMovement = {
      id: uid('mov-adj'),
      itemId: item.id,
      warehouseId: adjust.warehouseId,
      qty,
      reason: 'adjustment',
      note: adjust.note.trim() || undefined,
      at: new Date().toISOString(),
    };
    recordStockMovement(m);
    log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'task', message: `Stock: adjusted "${item.name}" by ${qty > 0 ? '+' : ''}${qty} (${whName(adjust.warehouseId)}).` });
    setShowAdjust(null);
    setAdjust({ warehouseId: '', qty: '', note: '' });
  };

  const stockOf = (item: InventoryItem, whId: string) => stockByWarehouse(stockMovements, item.id)[whId] ?? 0;

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Stock & Costing" sub="Quantities per location, weighted-average cost, and what the shelves are worth." />
        <Badge variant="secondary">{products.length} tracked product{products.length !== 1 ? 's' : ''}</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground"><TrendingUp className="h-4 w-4" /><span className="text-xs font-medium uppercase tracking-wide">Inventory value</span></div>
          <p className="mt-1 text-xl font-semibold">{money(value.total)}</p>
          <p className="text-[11px] text-muted-foreground">Weighted-average cost × on-hand</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground"><AlertTriangle className="h-4 w-4" /><span className="text-xs font-medium uppercase tracking-wide">Needs attention</span></div>
          <p className="mt-1 text-xl font-semibold">{lowStock.length}</p>
          <p className="text-[11px] text-muted-foreground">{lowStock.length ? 'Low or out — reorder soon' : 'Everything above its reorder point'}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground"><PackageX className="h-4 w-4" /><span className="text-xs font-medium uppercase tracking-wide">Movements</span></div>
          <p className="mt-1 text-xl font-semibold">{stockMovements.length}</p>
          <p className="text-[11px] text-muted-foreground">The ledger is the source of truth</p>
        </Card>
      </div>

      {lowStock.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            <span className="font-medium text-amber-600">Reorder:</span>
            {lowStock.map((p) => (
              <Badge key={p.id} variant="outline" className="border-amber-500/30 text-[10px] text-amber-700">
                {p.name} — {totalOnHand(stockMovements, p.id)} left (reorder at {p.reorderPoint}){p.supplierId && vendorName(p.supplierId) ? ` · ${vendorName(p.supplierId)}` : ''}
              </Badge>
            ))}
            <Button size="sm" variant="outline" className="ml-auto h-7 gap-1 border-amber-500/40 text-[11px] text-amber-700 hover:text-amber-600" onClick={() => lowStock.forEach(createReorderTask)}>
              Create {lowStock.length} reorder task{lowStock.length !== 1 ? 's' : ''}
            </Button>
          </div>
        </Card>
      )}

      <Card className="overflow-x-auto p-2">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="p-2 font-medium">Item</th>
              {activeWarehouses.map((w) => (
                <th key={w.id} className="p-2 font-medium">{w.name}</th>
              ))}
              <th className="p-2 font-medium">Total</th>
              <th className="p-2 font-medium">Avg cost</th>
              <th className="p-2 font-medium">Value</th>
              <th className="p-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {products.map((item) => {
              const c = recomputeCosting(stockMovements, item.id);
              const status = stockStatus(item, c.qtyOnHand);
              return (
                <tr key={item.id} className="border-t">
                  <td className="p-2">
                    <p className="font-medium">{item.name}</p>
                    <p className="font-mono text-[10px] text-muted-foreground">{item.sku}</p>
                  </td>
                  {activeWarehouses.map((w) => (
                    <td key={w.id} className={cn('p-2', stockOf(item, w.id) <= 0 && 'text-muted-foreground')}>{stockOf(item, w.id)}</td>
                  ))}
                  <td className="p-2 font-semibold">{c.qtyOnHand}</td>
                  <td className="p-2">{c.qtyOnHand > 0 ? money(c.avgCost) : '—'}</td>
                  <td className="p-2">{money(c.stockValue)}</td>
                  <td className="p-2">
                    <div className="flex items-center justify-end gap-1">
                      <Badge className={cn('text-[10px]', status === 'ok' ? 'bg-emerald-500/10 text-emerald-600' : status === 'low' ? 'bg-amber-500/10 text-amber-600' : 'bg-rose-500/10 text-rose-600')}>
                        {status === 'ok' ? 'ok' : status}
                      </Badge>
                      {status !== 'ok' && (
                        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px] text-amber-700 hover:text-amber-600" title="Create a reorder task" onClick={() => createReorderTask(item)}>
                          Reorder
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Receive stock" onClick={() => { setShowReceive(item); setReceive({ warehouseId: activeWarehouses[0]?.id ?? '', qty: '', unitCost: String(item.costPrice || ''), note: item.supplierId ? vendorName(item.supplierId) ?? '' : '' }); }}>
                        <PackagePlus className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Adjust" onClick={() => { setShowAdjust(item); setAdjust({ warehouseId: activeWarehouses[0]?.id ?? '', qty: '', note: '' }); }}>
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {products.length === 0 && (
              <tr><td colSpan={5 + activeWarehouses.length} className="p-6 text-center text-sm text-muted-foreground">No tracked products yet — add products in the Catalog to start managing stock.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Recent movements</h3>
          <Badge variant="secondary">{stockMovements.length}</Badge>
          <div className="relative ml-auto w-full sm:w-52">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={movementQuery} onChange={(e) => setMovementQuery(e.target.value)} placeholder="Filter item, reason, ref…" className="h-7 pl-8 text-xs" />
          </div>
        </div>
        <div className="max-h-80 space-y-1.5 overflow-y-auto">
          {(() => {
            const q = movementQuery.trim().toLowerCase();
            const list = q
              ? stockMovements.filter((m) => {
                  const item = inventoryItems.find((i) => i.id === m.itemId);
                  return `${item?.name ?? ''} ${m.reason} ${m.reference ?? ''} ${m.note ?? ''}`.toLowerCase().includes(q);
                })
              : stockMovements;
            return (
              <>
                {list.slice(0, 40).map((m) => {
                  const item = inventoryItems.find((i) => i.id === m.itemId);
                  return (
                    <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2 text-xs">
                      <Badge className={cn('text-[10px]', REASON_STYLE[m.reason])}>{m.reason}</Badge>
                      <span className="font-medium">{item?.name ?? m.itemId}</span>
                      <span className={cn('font-mono', m.qty > 0 ? 'text-emerald-600' : 'text-rose-600')}>{m.qty > 0 ? '+' : ''}{m.qty}</span>
                      <span className="text-muted-foreground">@ {whName(m.warehouseId)}</span>
                      {m.unitCost != null && <span className="text-muted-foreground">· {money(m.unitCost)}/unit</span>}
                      {m.reference && <span className="font-mono text-[10px] text-muted-foreground">{m.reference}</span>}
                      {m.note && <span className="truncate text-muted-foreground">— {m.note}</span>}
                      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{new Date(m.at).toLocaleString()}</span>
                    </div>
                  );
                })}
                {list.length === 0 && (
                  <p className="p-4 text-center text-xs text-muted-foreground">
                    {stockMovements.length === 0
                      ? 'No movements yet — receive stock or make a POS sale and the ledger starts here.'
                      : 'No movements match this filter.'}
                  </p>
                )}
                {list.length > 40 && (
                  <p className="p-2 text-center text-[10px] text-muted-foreground">Showing the 40 most recent of {list.length} — refine the filter to see more.</p>
                )}
              </>
            );
          })()}
        </div>
      </Card>

      {/* Receive stock */}
      <Dialog open={!!showReceive} onOpenChange={(o) => { if (!o) setShowReceive(null); }}>
        <DialogContent className="sm:max-w-md">
          {showReceive && (
            <>
              <DialogHeader>
                <DialogTitle>Receive stock — {showReceive.name}</DialogTitle>
                <DialogDescription>
                  Stock-in at cost: the weighted average moves toward this purchase.
                  {showReceive.supplierId && vendorName(showReceive.supplierId) ? ` Preferred supplier: ${vendorName(showReceive.supplierId)}.` : ''}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Into</label>
                  <Select value={receive.warehouseId} onValueChange={(v) => setReceive((s) => ({ ...s, warehouseId: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Location" /></SelectTrigger>
                    <SelectContent>
                      {activeWarehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name} ({w.kind})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Quantity</label>
                    <Input className="mt-1" type="number" min="0" value={receive.qty} onChange={(e) => setReceive((s) => ({ ...s, qty: e.target.value }))} placeholder="10" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Unit cost ({currency})</label>
                    <Input className="mt-1" type="number" min="0" step="0.01" value={receive.unitCost} onChange={(e) => setReceive((s) => ({ ...s, unitCost: e.target.value }))} placeholder="5.00" />
                  </div>
                </div>
                <Textarea rows={2} value={receive.note} onChange={(e) => setReceive((s) => ({ ...s, note: e.target.value }))} placeholder="Supplier, PO number… (optional)" />
                <Button className="w-full" onClick={doReceive} disabled={!receive.qty || !receive.warehouseId}>Receive</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Adjust stock */}
      <Dialog open={!!showAdjust} onOpenChange={(o) => { if (!o) setShowAdjust(null); }}>
        <DialogContent className="sm:max-w-md">
          {showAdjust && (
            <>
              <DialogHeader>
                <DialogTitle>Adjust — {showAdjust.name}</DialogTitle>
                <DialogDescription>Counted corrections. Positive adds, negative writes off. The average cost is untouched.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Location</label>
                  <Select value={adjust.warehouseId} onValueChange={(v) => setAdjust((s) => ({ ...s, warehouseId: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Location" /></SelectTrigger>
                    <SelectContent>
                      {activeWarehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name} ({w.kind})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Adjustment (+/−)</label>
                  <Input className="mt-1" type="number" value={adjust.qty} onChange={(e) => setAdjust((s) => ({ ...s, qty: e.target.value }))} placeholder="-2" />
                </div>
                <Textarea rows={2} value={adjust.note} onChange={(e) => setAdjust((s) => ({ ...s, note: e.target.value }))} placeholder="Reason (damage, count correction…)" />
                <Button className="w-full" onClick={doAdjust} disabled={!adjust.qty || !adjust.warehouseId}>Post adjustment</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
