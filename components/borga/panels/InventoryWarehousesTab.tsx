'use client';

import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, ArrowLeftRight, Warehouse as WarehouseIcon, Store } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBorga } from '@/lib/borga/store';
import { fmtMoney } from '@/lib/borga/currencies';
import { recomputeCosting, stockByWarehouse, valuation, type Warehouse, type StockMovement } from '@/lib/borga/inventory';
import { toast } from '@/lib/toast-bus';
import { SectionTitle } from '../bits';
import { SearchSelect } from '../SearchSelect';
import { ConfirmDialog } from '../ConfirmDialog';

/** Id generation lives outside the component so handlers stay pure from the linter's point of view. */
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export function InventoryWarehousesTab() {
  const {
    warehouses, addWarehouse, updateWarehouse, deleteWarehouse,
    inventoryItems, stockMovements, recordStockMovement, activeWorkspace, log,
  } = useBorga();
  const currency = activeWorkspace()?.currency ?? 'USD';
  const money = (n: number) => fmtMoney(n, currency);

  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<Warehouse | null>(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [confirmDeleteWarehouse, setConfirmDeleteWarehouse] = useState<Warehouse | null>(null);
  const [transfer, setTransfer] = useState({ itemId: '', from: '', to: '', qty: '' });

  const editingWh = form ?? editing;
  const patch = (p: Partial<Warehouse>) => setForm((f) => (editing ? { ...(f ?? editing), ...p } : f));

  const tracked = useMemo(() => inventoryItems.filter((i) => i.type === 'product' && i.trackStock), [inventoryItems]);
  const value = useMemo(() => valuation(stockMovements, inventoryItems), [stockMovements, inventoryItems]);

  const openNew = () => {
    setIsNew(true);
    setForm({
      id: uid('wh'),
      name: '',
      code: `WH-${String(warehouses.length + 1).padStart(2, '0')}`,
      kind: 'warehouse',
      address: '',
      active: true,
    });
    setEditing(null);
  };

  const save = () => {
    if (!editingWh || !editingWh.name.trim()) return;
    if (isNew) {
      addWarehouse({ ...editingWh, name: editingWh.name.trim() });
      log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'task', message: `Locations: added ${editingWh.kind} "${editingWh.name.trim()}".` });
    } else {
      updateWarehouse(editingWh.id, editingWh);
    }
    setForm(null);
    setEditing(null);
    setIsNew(false);
  };

  const doTransfer = () => {
    const item = inventoryItems.find((i) => i.id === transfer.itemId);
    const qty = Math.max(0, Number(transfer.qty) || 0);
    if (!item || !qty || !transfer.from || !transfer.to) return;
    if (transfer.from === transfer.to) {
      toast({ title: 'Pick two different locations', variant: 'error' });
      return;
    }
    const available = stockByWarehouse(stockMovements, item.id)[transfer.from] ?? 0;
    if (qty > available) {
      toast({ title: `Only ${available} at the source location`, variant: 'error' });
      return;
    }
    const avg = recomputeCosting(stockMovements, item.id).avgCost;
    const now = new Date().toISOString();
    const out: StockMovement = {
      id: uid('mov-tr-out'),
      itemId: item.id, warehouseId: transfer.from, qty: -qty, reason: 'transfer-out', at: now,
    };
    const into: StockMovement = {
      id: uid('mov-tr-in'),
      itemId: item.id, warehouseId: transfer.to, qty, unitCost: avg, reason: 'transfer-in', at: now,
      reference: 'transfer',
    };
    recordStockMovement(out);
    recordStockMovement(into);
    const whName = (id: string) => warehouses.find((w) => w.id === id)?.name ?? id;
    log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'task', message: `Stock: moved ${qty} × "${item.name}" from ${whName(transfer.from)} to ${whName(transfer.to)}.` });
    setShowTransfer(false);
    setTransfer({ itemId: '', from: '', to: '', qty: '' });
  };

  const remove = (wh: Warehouse) => {
    setConfirmDeleteWarehouse(wh);
  };

  const doRemove = () => {
    const wh = confirmDeleteWarehouse;
    if (!wh) return;
    const hasStock = stockMovements.some((m) => m.warehouseId === wh.id && (stockByWarehouse(stockMovements, m.itemId)[wh.id] ?? 0) > 0);
    if (hasStock) {
      toast({ title: 'This location still holds stock', description: 'Move or write its stock off before deleting it.', variant: 'error' });
      setConfirmDeleteWarehouse(null);
      return;
    }
    deleteWarehouse(wh.id);
    log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'task', message: `Locations: deleted "${wh.name}".` });
    setConfirmDeleteWarehouse(null);
  };

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Warehouses & Stores" sub="Where stock lives — receive, count and transfer between any two locations." />
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowTransfer(true)} disabled={tracked.length === 0 || warehouses.length < 2}>
            <ArrowLeftRight className="h-3.5 w-3.5" /> Transfer stock
          </Button>
          <Button size="sm" onClick={openNew} className="gap-1.5">
            <Plus className="h-4 w-4" /> New location
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {warehouses.map((wh) => {
          const v = value.warehouses.find((w) => w.warehouseId === wh.id);
          const distinct = stockMovements.filter((m) => m.warehouseId === wh.id && m.itemId).length;
          return (
            <Card key={wh.id} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  {wh.kind === 'store'
                    ? <Store className="h-4 w-4 text-primary" />
                    : <WarehouseIcon className="h-4 w-4 text-primary" />}
                  <div>
                    <p className="text-sm font-semibold">{wh.name}</p>
                    <p className="font-mono text-[10px] text-muted-foreground">{wh.code}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className="text-[10px]">{wh.kind}</Badge>
                  {!wh.active && <Badge variant="outline" className="text-[10px] text-muted-foreground">inactive</Badge>}
                </div>
              </div>
              {wh.address && <p className="text-xs text-muted-foreground">{wh.address}</p>}
              <div className="flex items-center justify-between rounded-lg bg-muted/40 p-2.5">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Stock value</p>
                  <p className="text-sm font-semibold">{money(v?.stockValue ?? 0)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Item lines</p>
                  <p className="text-sm font-semibold">{v?.itemLines ?? 0}</p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-1">
                <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit" onClick={() => { setIsNew(false); setEditing(wh); setForm(null); }}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-rose-500" title="Delete" onClick={() => remove(wh)} disabled={warehouses.length <= 1}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">{distinct} movement{distinct !== 1 ? 's' : ''} recorded at this location{warehouses.length <= 1 ? ' · the last location cannot be deleted' : ''}</p>
            </Card>
          );
        })}
      </div>

      {/* Transfer dialog */}
      <Dialog open={showTransfer} onOpenChange={setShowTransfer}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Transfer stock</DialogTitle>
            <DialogDescription>Moves stock at its current weighted-average cost — the total value never changes.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Item</label>
              <SearchSelect
                options={tracked.map((i) => ({ value: i.id, label: i.name, detail: `${totalOnHandOf(i.id)} on hand` }))}
                value={transfer.itemId}
                onChange={(v) => setTransfer((s) => ({ ...s, itemId: v }))}
                placeholder="Pick a product"
                searchPlaceholder="Search products"
                clearable={false}
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">From</label>
                <Select value={transfer.from} onValueChange={(v) => setTransfer((s) => ({ ...s, from: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">To</label>
                <Select value={transfer.to} onValueChange={(v) => setTransfer((s) => ({ ...s, to: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Qty</label>
                <Input className="mt-1" type="number" min="0" value={transfer.qty} onChange={(e) => setTransfer((s) => ({ ...s, qty: e.target.value }))} />
              </div>
            </div>
            <Button className="w-full gap-1.5" onClick={doTransfer} disabled={!transfer.itemId || !transfer.qty || !transfer.from || !transfer.to}>
              <ArrowLeftRight className="h-4 w-4" /> Move stock
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* New/Edit location */}
      <Dialog open={!!editingWh} onOpenChange={(o) => { if (!o) { setForm(null); setEditing(null); setIsNew(false); } }}>
        <DialogContent className="sm:max-w-md">
          {editingWh && (
            <>
              <DialogHeader>
                <DialogTitle>{isNew ? 'New location' : `Edit ${editingWh.name}`}</DialogTitle>
                <DialogDescription>A store is a customer-facing register location; a warehouse holds bulk or backup stock.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-[1fr_130px] gap-3">
                  <Input value={editingWh.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Downtown Store" />
                  <Input className="font-mono" value={editingWh.code} onChange={(e) => patch({ code: e.target.value.slice(0, 12) })} placeholder="STORE-02" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Kind</label>
                  <Select value={editingWh.kind} onValueChange={(v) => patch({ kind: v as Warehouse['kind'] })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="store">Store</SelectItem>
                      <SelectItem value="warehouse">Warehouse</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Input value={editingWh.address} onChange={(e) => patch({ address: e.target.value.slice(0, 200) })} placeholder="Address (optional)" />
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <Switch checked={editingWh.active} onCheckedChange={(v) => patch({ active: v })} id="wh-active" />
                    <label htmlFor="wh-active" className="text-sm">{editingWh.active ? 'Active' : 'Inactive'}</label>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => { setForm(null); setEditing(null); setIsNew(false); }}>Cancel</Button>
                    <Button onClick={save} disabled={!editingWh.name.trim()}>{isNew ? 'Add location' : 'Save changes'}</Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDeleteWarehouse}
        onOpenChange={(o) => { if (!o) setConfirmDeleteWarehouse(null); }}
        title={`Delete "${confirmDeleteWarehouse?.name ?? 'location'}"?`}
        description="The location is removed. Its movement history stays in the ledger under the location name."
        confirmLabel="Delete location"
        onConfirm={doRemove}
      />
    </div>
  );

  function totalOnHandOf(itemId: string): number {
    return stockMovements.filter((m) => m.itemId === itemId).reduce((n, m) => n + m.qty, 0);
  }
}
