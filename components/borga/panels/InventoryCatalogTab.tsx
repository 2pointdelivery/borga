'use client';

import { useMemo, useState } from 'react';
import { Plus, Search, Pencil, Trash2, Sparkles, Package, Wrench, Barcode, Percent } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBorga } from '@/lib/borga/store';
import { fmtMoney } from '@/lib/borga/currencies';
import { assignBarcode, ean13Bars, totalOnHand, stockStatus, type InventoryItem, type ItemType } from '@/lib/borga/inventory';
import { toast } from '@/lib/toast-bus';
import { SectionTitle } from '../bits';
import { SearchSelect } from '../SearchSelect';
import { ConfirmDialog } from '../ConfirmDialog';
import { cn } from '@/lib/utils';

const STATUS_STYLE: Record<string, string> = {
  ok: 'bg-emerald-500/10 text-emerald-600',
  low: 'bg-amber-500/10 text-amber-600',
  out: 'bg-rose-500/10 text-rose-600',
  'n-a': 'bg-muted text-muted-foreground',
};

const STATUS_LABEL: Record<string, string> = { ok: 'In stock', low: 'Low', out: 'Out', 'n-a': 'Service' };

/** Billing units offered for services — products keep free-form units (ea, kg, box…). */
const SERVICE_UNITS = ['engagement', 'hr', 'day', 'month', 'visit', 'fixed fee'];

/** Id generation lives outside the component so handlers stay pure from the linter's point of view. */
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

/** Scannable EAN-13 rendered from the real module pattern (guards included). */
export function BarcodeGlyph({ code, className }: { code: string; className?: string }) {
  const bits = ean13Bars(code);
  const bars: number[] = [];
  let i = 0;
  while (i < bits.length) {
    if (bits[i] === '1') {
      let w = 1;
      while (i + w < bits.length && bits[i + w] === '1') w++;
      bars.push(w);
      i += w;
    } else i++;
  }
  return (
    <svg viewBox="0 0 95 40" preserveAspectRatio="none" className={cn('h-8 w-24', className)} role="img" aria-label={`barcode ${code}`}>
      <rect width="95" height="40" fill="transparent" />
      {(() => {
        const out: React.ReactElement[] = [];
        let x = 0;
        for (const w of bars) {
          out.push(<rect key={x} x={x} y={0} width={w} height={40} fill="currentColor" />);
          x += w + 1; // 1-module space between bars
        }
        return out;
      })()}
    </svg>
  );
}

function describePayload(item: InventoryItem) {
  return { id: item.id, name: item.name, type: item.type, category: item.category, unit: item.unit, price: item.price };
}

export function InventoryCatalogTab() {
  const { inventoryItems, addItem, updateItem, deleteItem, stockMovements, vendors, activeWorkspace, activeWorkspaceId, log } = useBorga();
  const currency = activeWorkspace()?.currency ?? 'USD';
  const companyName = activeWorkspace()?.name ?? 'the company';
  const money = (n: number) => fmtMoney(n, currency);
  const vendorName = (id?: string) => vendors.find((v) => v.id === id)?.name;

  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | ItemType>('all');
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<InventoryItem | null>(null);
  const [confirmDeleteItem, setConfirmDeleteItem] = useState<InventoryItem | null>(null);
  const [describing, setDescribing] = useState<string | null>(null);
  const [bulkDescribing, setBulkDescribing] = useState(false);

  const editingItem = form ?? editing;
  const patch = (p: Partial<InventoryItem>) => setForm((f) => (editing ? { ...(f ?? editing), ...p } : f));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inventoryItems.filter((i) =>
      (typeFilter === 'all' || i.type === typeFilter)
      && (!q || `${i.name} ${i.sku} ${i.barcode} ${i.category}`.toLowerCase().includes(q)),
    );
  }, [inventoryItems, query, typeFilter]);

  const switchType = (type: ItemType) => {
    // Alternating fields: switching type resets everything stock-related.
    if (type === 'service') {
      patch({ type, trackStock: false, barcode: '', sku: '', reorderPoint: 0, supplierId: undefined, unit: 'engagement' });
    } else {
      patch({
        type, trackStock: true, barcode: editingItem?.barcode || assignBarcode(inventoryItems),
        sku: editingItem?.sku || `INV-${String(inventoryItems.length + 1).padStart(4, '0')}`,
        unit: editingItem?.unit && editingItem.unit !== 'engagement' ? editingItem.unit : 'ea',
      });
    }
  };

  const openNew = (type: ItemType = 'product') => {
    setIsNew(true);
    const base: InventoryItem = {
      id: uid('item'),
      name: '',
      type,
      sku: '',
      barcode: '',
      category: '',
      description: '',
      unit: type === 'service' ? 'engagement' : 'ea',
      costPrice: 0,
      price: 0,
      taxRate: 0,
      trackStock: type === 'product',
      reorderPoint: 0,
      active: true,
      createdAtIso: new Date().toISOString(),
    };
    if (type === 'product') {
      base.barcode = assignBarcode(inventoryItems);
      base.sku = `INV-${String(inventoryItems.length + 1).padStart(4, '0')}`;
    }
    setForm(base);
    setEditing(null);
  };

  const openEdit = (item: InventoryItem) => {
    setIsNew(false);
    setEditing(item);
    setForm(null);
  };

  const save = () => {
    if (!editingItem || !editingItem.name.trim()) return;
    const item = { ...editingItem, name: editingItem.name.trim() };
    if (isNew) {
      addItem(item);
      log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'task', message: `Catalog: added ${item.type} "${item.name}"${item.barcode ? ` (barcode ${item.barcode})` : ''}.` });
    } else {
      updateItem(item.id, item);
      log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'task', message: `Catalog: updated "${item.name}".` });
    }
    setForm(null);
    setEditing(null);
    setIsNew(false);
  };

  const describe = async (item: InventoryItem) => {
    setDescribing(item.id);
    try {
      const r = await fetch('/api/borga/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ action: 'describe', ...describePayload(item), currency, companyName, ws: activeWorkspaceId }),
      });
      const d = await r.json() as { ok?: boolean; description?: string; source?: 'model' | 'template' };
      if (d.ok && d.description) {
        updateItem(item.id, { description: d.description });
        toast({
          title: d.source === 'model' ? 'Description written by the workspace model' : 'No model configured — factual template used',
          variant: 'success',
        });
      } else {
        toast({ title: (d as { error?: string }).error ?? 'Could not generate', variant: 'error' });
      }
    } catch {
      toast({ title: 'Could not reach the server', variant: 'error' });
    } finally {
      setDescribing(null);
    }
  };

  const describeMissing = async () => {
    const missing = inventoryItems.filter((i) => !i.description.trim()).slice(0, 8);
    if (!missing.length) {
      toast({ title: 'Every item already has a description', variant: 'success' });
      return;
    }
    setBulkDescribing(true);
    try {
      const r = await fetch('/api/borga/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ action: 'describeMany', items: missing.map(describePayload), currency, companyName, ws: activeWorkspaceId }),
      });
      const d = await r.json() as { ok?: boolean; results?: Array<{ id?: string; description?: string }> };
      let n = 0;
      for (const res of d.results ?? []) {
        if (res.id && res.description) {
          updateItem(res.id, { description: res.description });
          n++;
        }
      }
      if (n) toast({ title: `Wrote ${n} description${n !== 1 ? 's' : ''}`, variant: 'success' });
      else toast({ title: 'Nothing generated', variant: 'error' });
    } catch {
      toast({ title: 'Could not reach the server', variant: 'error' });
    } finally {
      setBulkDescribing(false);
    }
  };

  const products = inventoryItems.filter((i) => i.type === 'product').length;
  const services = inventoryItems.filter((i) => i.type === 'service').length;
  const isProduct = editingItem?.type === 'product';

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle
          title="Catalog"
          sub="Products and services you sell — barcodes and AI descriptions for products, clean cataloging for services."
        />
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={describeMissing} disabled={bulkDescribing || !inventoryItems.length}>
            <Sparkles className="h-3.5 w-3.5" /> {bulkDescribing ? 'Writing…' : 'AI-describe missing'}
          </Button>
          <Button size="sm" onClick={() => openNew('product')} className="gap-1.5">
            <Package className="h-4 w-4" /> New product
          </Button>
          <Button size="sm" variant="outline" onClick={() => openNew('service')} className="gap-1.5">
            <Wrench className="h-4 w-4" /> New service
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(['all', 'product', 'service'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                typeFilter === t ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:border-primary hover:text-primary',
              )}
            >
              {t === 'product' && <Package className="h-3 w-3" />}
              {t === 'service' && <Wrench className="h-3 w-3" />}
              {t === 'all' ? `All (${inventoryItems.length})` : t === 'product' ? `Products (${products})` : `Services (${services})`}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, SKU, barcode…" className="h-9 pl-8 text-sm" />
        </div>
      </div>

      {inventoryItems.length === 0 ? (
        <Card className="space-y-2 p-8 text-center">
          <p className="text-sm font-medium">Nothing in the catalog yet.</p>
          <p className="mx-auto max-w-md text-xs text-muted-foreground">
            A company that provides services starts here: add services and sell them from the Point of Sale with no stock tracking.
            If you deal in physical goods, add products and you get auto-assigned EAN-13 barcodes, stock levels with weighted-average
            costing, warehouses or stores, and the full POS.
          </p>
          <div className="flex justify-center gap-2 pt-2">
            <Button size="sm" onClick={() => openNew('service')} className="gap-1.5"><Wrench className="h-4 w-4" /> Add a service</Button>
            <Button size="sm" variant="outline" onClick={() => openNew('product')} className="gap-1.5"><Package className="h-4 w-4" /> Add a product</Button>
          </div>
        </Card>
      ) : (
        <Card className="divide-y p-2">
          {filtered.map((item) => {
            const status = stockStatus(item, totalOnHand(stockMovements, item.id));
            const margin = item.price > 0 ? Math.round(((item.price - item.costPrice) / item.price) * 100) : null;
            return (
              <div key={item.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{item.name}</p>
                    <Badge variant="outline" className="text-[10px]">{item.type}</Badge>
                    {!item.active && <Badge variant="outline" className="text-[10px] text-muted-foreground">inactive</Badge>}
                    {item.category && <span className="text-[10px] text-muted-foreground">{item.category}</span>}
                    {item.type === 'product' && vendorName(item.supplierId) && (
                      <span className="text-[10px] text-muted-foreground">via {vendorName(item.supplierId)}</span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    {item.sku && <span className="font-mono">{item.sku}</span>}
                    {item.barcode && (
                      <span className="flex items-center gap-1 font-mono">
                        <Barcode className="h-3 w-3" /> {item.barcode}
                      </span>
                    )}
                    <span>{money(item.price)} / {item.unit}</span>
                    {item.type === 'product' && margin != null && (
                      <span className="flex items-center gap-0.5" title="Margin (price − cost) / price">
                        <Percent className="h-3 w-3" /> {margin}% margin
                      </span>
                    )}
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', STATUS_STYLE[status])}>{STATUS_LABEL[status]}</span>
                  </div>
                  {item.description && <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{item.description}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {item.barcode && <span className="mr-1 hidden text-foreground sm:block"><BarcodeGlyph code={item.barcode} /></span>}
                  <Button size="icon" variant="ghost" className="h-7 w-7" title="Write description with AI" disabled={describing === item.id} onClick={() => describe(item)}>
                    <Sparkles className={cn('h-3.5 w-3.5', describing === item.id && 'animate-pulse text-primary')} />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit" onClick={() => openEdit(item)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon" variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-rose-500"
                    title="Delete"
                    onClick={() => setConfirmDeleteItem(item)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">No items match this filter.</p>
          )}
        </Card>
      )}

      <Dialog open={!!editingItem} onOpenChange={(o) => { if (!o) { setForm(null); setEditing(null); setIsNew(false); } }}>
        <DialogContent className="sm:max-w-xl">
          {editingItem && (
            <>
              <DialogHeader>
                <DialogTitle>{isNew ? (isProduct ? 'Add a product' : 'Add a service') : `Edit ${editingItem.name}`}</DialogTitle>
                <DialogDescription>
                  {isProduct
                    ? 'Products track stock, carry an auto-assigned internal EAN-13 barcode, cost against a supplier, and feed costing and the POS.'
                    : 'Services have no stock, barcode or supplier — they bill by unit (hour, day, engagement…) and still sell at the POS.'}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                {/* Type switch alternates the whole form below. */}
                <div className="flex items-center gap-1 rounded-lg border p-1">
                  <button
                    onClick={() => switchType('product')}
                    className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors', isProduct ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
                  >
                    <Package className="h-3.5 w-3.5" /> Product
                  </button>
                  <button
                    onClick={() => switchType('service')}
                    className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors', !isProduct ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
                  >
                    <Wrench className="h-3.5 w-3.5" /> Service
                  </button>
                </div>

                <Input value={editingItem.name} onChange={(e) => patch({ name: e.target.value })} placeholder={isProduct ? 'Product name' : 'Service name'} />

                <div className={cn('grid gap-3', isProduct ? 'grid-cols-3' : 'grid-cols-2')}>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Category</label>
                    <Input className="mt-1" value={editingItem.category} onChange={(e) => patch({ category: e.target.value.slice(0, 60) })} placeholder={isProduct ? 'Power Tools' : 'Consulting'} />
                  </div>
                  {isProduct ? (
                    <>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">SKU</label>
                        <Input className="mt-1 font-mono" value={editingItem.sku} onChange={(e) => patch({ sku: e.target.value.slice(0, 20) })} placeholder="INV-0001" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Unit</label>
                        <Input className="mt-1" value={editingItem.unit} onChange={(e) => patch({ unit: e.target.value.slice(0, 20) })} placeholder="ea / kg / box" />
                      </div>
                    </>
                  ) : (
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Billing unit</label>
                      <Select value={editingItem.unit} onValueChange={(v) => patch({ unit: v })}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {SERVICE_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                {isProduct && editingItem.barcode && (
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div className="flex items-center gap-3">
                      <BarcodeGlyph code={editingItem.barcode} className="text-foreground" />
                      <div>
                        <p className="font-mono text-xs">{editingItem.barcode}</p>
                        <p className="text-[10px] text-muted-foreground">Internal EAN-13 — reserved in-store range, scannable on any reader.</p>
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" className="text-xs" onClick={() => patch({ barcode: assignBarcode(inventoryItems.filter((i) => i.id !== editingItem.id)) })}>
                      Reassign
                    </Button>
                  </div>
                )}

                <div className={cn('grid gap-3', isProduct ? 'grid-cols-4' : 'grid-cols-2')}>
                  {isProduct && (
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Cost</label>
                      <Input className="mt-1" type="number" min={0} step="0.01" value={editingItem.costPrice} onChange={(e) => patch({ costPrice: Math.max(0, Number(e.target.value) || 0) })} />
                    </div>
                  )}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Price</label>
                    <Input className="mt-1" type="number" min={0} step="0.01" value={editingItem.price} onChange={(e) => patch({ price: Math.max(0, Number(e.target.value) || 0) })} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Tax %</label>
                    <Input className="mt-1" type="number" min={0} max={100} step="0.5" value={editingItem.taxRate} onChange={(e) => patch({ taxRate: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />
                  </div>
                  {isProduct && (
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Reorder at</label>
                      <Input className="mt-1" type="number" min={0} value={editingItem.reorderPoint} onChange={(e) => patch({ reorderPoint: Math.max(0, Number(e.target.value) || 0) })} />
                    </div>
                  )}
                </div>

                {isProduct && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Preferred supplier</label>
                    <SearchSelect
                      options={[
                        { value: 'none', label: 'No preferred supplier' },
                        ...vendors.map((v) => ({ value: v.id, label: v.name, detail: v.service })),
                      ]}
                      value={editingItem.supplierId ?? 'none'}
                      onChange={(v) => patch({ supplierId: v === 'none' ? undefined : v })}
                      placeholder="No preferred supplier"
                      searchPlaceholder="Search vendors"
                      clearable={false}
                      className="mt-1"
                    />
                  </div>
                )}

                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground">Description</label>
                    <Button size="sm" variant="ghost" className="h-6 gap-1 text-xs" disabled={describing === editingItem.id || !editingItem.name.trim()} onClick={() => describe(editingItem)}>
                      <Sparkles className="h-3 w-3" /> {describing === editingItem.id ? 'Writing…' : 'Generate with AI'}
                    </Button>
                  </div>
                  <Textarea rows={3} value={editingItem.description} onChange={(e) => patch({ description: e.target.value.slice(0, 600) })} placeholder="What this item is and who it is for — generated or written by hand." />
                </div>

                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <Switch checked={editingItem.active} onCheckedChange={(v) => patch({ active: v })} id="item-active" />
                    <label htmlFor="item-active" className="text-sm">{editingItem.active ? 'Active — sellable at the POS' : 'Inactive'}</label>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => { setForm(null); setEditing(null); setIsNew(false); }}>Cancel</Button>
                    <Button className="gap-1.5" onClick={save} disabled={!editingItem.name.trim()}>
                      <Plus className="h-4 w-4" /> {isNew ? (isProduct ? 'Add product' : 'Add service') : 'Save changes'}
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDeleteItem}
        onOpenChange={(o) => { if (!o) setConfirmDeleteItem(null); }}
        title={`Delete "${confirmDeleteItem?.name ?? 'item'}"?`}
        description="Its stock-movement and sales history stays in the ledger but loses the item name. Deactivating keeps everything and hides it from the register."
        confirmLabel="Delete item"
        onConfirm={() => {
          if (!confirmDeleteItem) return;
          deleteItem(confirmDeleteItem.id);
          log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'task', message: `Catalog: deleted "${confirmDeleteItem.name}".` });
          setConfirmDeleteItem(null);
        }}
      >
        <div className="flex justify-start">
          <Button
            size="sm" variant="outline"
            onClick={() => {
              if (!confirmDeleteItem) return;
              updateItem(confirmDeleteItem.id, { active: false });
              log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'task', message: `Catalog: deactivated "${confirmDeleteItem.name}" instead of deleting.` });
              setConfirmDeleteItem(null);
            }}
          >
            Deactivate instead
          </Button>
        </div>
      </ConfirmDialog>
    </div>
  );
}
