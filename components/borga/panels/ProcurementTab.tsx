'use client';
import { useState } from 'react';
import { Eye, Check, ReceiptText, Ban, Trash2, Send } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SectionTitle } from '../bits';
import { useBorga } from '@/lib/borga/store';
import { poTotal, poReceivedTotal, threeWayMatch, type PurchaseOrder, type POLine, type POStatus } from '@/lib/borga/procurement';
import { FormDialog, Field, FieldGrid, TextField, NotesField } from '../form-kit';
import { CurrencySelect } from '../form-widgets';
import { SearchSelect } from '../SearchSelect';
import { FilterPills, TableSearch, TableToolbar, CrudTable, IdCell, TextCell, AmountCell, StatusBadge, EmptyRow, IconBtn, RowActions } from '../data-table';
import { DocumentEmailDialog, type DocumentEmailTarget } from '../DocumentEmailDialog';
import { cn } from '@/lib/utils';

const STATUS_STYLE: Record<POStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  ordered: 'bg-sky-500/10 text-sky-600',
  partial: 'bg-amber-500/10 text-amber-600',
  received: 'bg-emerald-500/10 text-emerald-600',
  billed: 'bg-violet-500/10 text-violet-600',
  void: 'bg-rose-500/10 text-rose-600',
};

export function ProcurementTab() {
  const { purchaseOrders, upsertPurchaseOrder, deletePurchaseOrder, vendors, inventoryItems, warehouses, activeWorkspace, activeWorkspaceId, hydrate, log } = useBorga();
  const wsCurrency = activeWorkspace()?.currency ?? 'USD';
  const [showNew, setShowNew] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const [currency, setCurrency] = useState('');
  const [lines, setLines] = useState<POLine[]>([{ label: '', qty: 1, unitCost: 0 }]);
  const [expectedIso, setExpectedIso] = useState('');
  const [poNotes, setPoNotes] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [recv, setRecv] = useState<Record<string, Record<number, string>>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | POStatus>('all');
  const [query, setQuery] = useState('');
  const [emailPo, setEmailPo] = useState<PurchaseOrder | null>(null);
  const [emailTarget, setEmailTarget] = useState<DocumentEmailTarget | null>(null);

  const openPoEmail = (po: PurchaseOrder) => {
    const vendor = vendors.find((v) => v.id === po.vendorId || v.name.toLowerCase() === po.vendorName.toLowerCase());
    const wsName = activeWorkspace()?.legalName ?? activeWorkspace()?.name ?? 'Our Team';
    const cur = po.currency ?? wsCurrency;
    const total = poTotal(po);
    setEmailPo(po);
    setEmailTarget({
      to: vendor?.email ?? '',
      subject: `Purchase Order ${po.number} from ${wsName}`,
      body: `Hi ${po.vendorName},\n\nPlease find attached Purchase Order ${po.number} for ${cur} ${total.toFixed(2)}.${po.expectedIso ? `\n\nRequested delivery date: ${po.expectedIso}` : ''}${po.notes ? `\n\nDelivery notes: ${po.notes}` : ''}\n\nPlease confirm receipt and expected dispatch date.\n\nKind regards,\n${wsName}`,
      document: {
        kind: 'purchase_order',
        workspaceName: wsName,
        documentNumber: po.number,
        recipientName: po.vendorName,
        currency: cur,
        totalAmount: total,
        subtotalAmount: total,
        issuedDate: po.orderedAt,
        dueOrValidDate: po.expectedIso,
        lines: po.lines.map((l) => ({
          label: l.label,
          qty: l.qty,
          unitPrice: l.unitCost,
          amount: l.qty * l.unitCost,
        })),
      },
    });
  };

  const visible = purchaseOrders
    .filter((p) => (filter === 'all' ? true : p.status === filter))
    .filter((p) => (query ? `${p.number} ${p.vendorName}`.toLowerCase().includes(query.toLowerCase()) : true));

  const create = () => {
    const v = vendors.find((x) => x.id === vendorId);
    if (!v) { setMsg('Pick a vendor first.'); return; }
    const clean = lines.filter((l) => l.label.trim() && l.qty > 0);
    if (clean.length === 0) { setMsg('Add at least one line.'); return; }
    const po: PurchaseOrder = {
      id: `po-${Date.now().toString(36)}`, number: `PO-${purchaseOrders.length + 1}`,
      vendorId: v.id, vendorName: v.name, lines: clean, status: 'draft',
      orderedAt: new Date().toISOString().slice(0, 10),
      currency: currency.trim().toUpperCase() && currency.trim().toUpperCase() !== wsCurrency ? currency.trim().toUpperCase() : undefined,
      expectedIso: expectedIso || undefined, notes: poNotes.trim() || undefined,
    };
    upsertPurchaseOrder(po);
    setShowNew(false); setVendorId(''); setCurrency(''); setLines([{ label: '', qty: 1, unitCost: 0 }]);
    setExpectedIso(''); setPoNotes('');
    setMsg(`Draft ${po.number} created — order it, then receive goods.`);
  };

  const setStatus = (id: string, status: POStatus) => {
    const po = purchaseOrders.find((p) => p.id === id);
    if (po) upsertPurchaseOrder({ ...po, status });
  };

  const callReceive = async (po: PurchaseOrder) => {
    const lineMap = recv[po.id] ?? {};
    const payload = Object.entries(lineMap)
      .map(([index, qty]) => ({ index: Number(index), qty: Number(qty) || 0 }))
      .filter((r) => r.qty > 0);
    if (payload.length === 0) { setMsg('Enter a received quantity for at least one line.'); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/borga/purchase-orders/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ ws: activeWorkspaceId, poId: po.id, lines: payload }),
      });
      const d = await r.json() as { ok?: boolean; error?: string; status?: string; movements?: number };
      setMsg(d.ok ? `Received → ${d.status} (${d.movements} stock moves at actual cost).` : `Receive failed: ${d.error}`);
      setRecv((m) => ({ ...m, [po.id]: {} }));
      void hydrate();
    } finally { setBusy(false); }
  };

  const callBill = async (po: PurchaseOrder) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/borga/purchase-orders/bill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ ws: activeWorkspaceId, poId: po.id }),
      });
      const d = await r.json() as { ok?: boolean; error?: string; billId?: string; total?: number };
      setMsg(d.ok ? `Bill ${d.billId} created (${d.total}) — see Vendors & AP.` : `Bill failed: ${d.error}`);
      void hydrate();
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <SectionTitle title="Purchase orders" sub="Order stock from suppliers. When goods arrive, one click puts them on your shelves — and the supplier's bill checks itself." />
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
      <Card className="p-4">
        <p className="text-sm font-semibold">How this works (4 steps)</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-muted-foreground">
          <li><strong className="text-foreground">Order:</strong> tell the supplier what you want and mark it ordered.</li>
          <li><strong className="text-foreground">Receive:</strong> when boxes arrive, enter what came — stock appears at what you actually paid.</li>
          <li><strong className="text-foreground">Check:</strong> we compare order vs delivery vs bill automatically (the “3-way match”).</li>
          <li><strong className="text-foreground">Bill:</strong> everything matches? Create the vendor bill in one click.</li>
        </ol>
        <p className="mt-1 text-xs text-muted-foreground">💡 Tip: receive goods the day they arrive — your stock value and reorder alerts stay correct.</p>
      </Card>
      <TableToolbar>
        <FilterPills options={['all', 'draft', 'ordered', 'partial', 'received', 'billed', 'void'] as const} value={filter} onChange={setFilter} />
        <TableSearch value={query} onChange={setQuery} placeholder="Search orders…" />
        <Button onClick={() => setShowNew(true)}>＋ New purchase order</Button>
      </TableToolbar>
      <CrudTable headers={['Order', 'Supplier', 'Ordered → Expected', <span key="a" className="block text-right">Amount</span>, 'Status']}>
        {visible.map((po) => {
          const match = threeWayMatch(po, poTotal(po));
          const voidable = po.status !== 'billed' && po.status !== 'void';
          const today = new Date().toISOString().slice(0, 10);
          const late = po.expectedIso && po.expectedIso < today && (po.status === 'ordered' || po.status === 'partial');
          return (
            <>
              <tr key={po.id} className="border-b last:border-0 hover:bg-muted/20">
                <IdCell sub={po.expectedIso ? `expected ${po.expectedIso}` : undefined}>{po.number}</IdCell>
                <TextCell>{po.vendorName}</TextCell>
                <TextCell sub={late ? 'running late' : undefined}>{po.orderedAt} → {po.expectedIso ?? '—'}</TextCell>
                <AmountCell value={`${po.currency ?? ''} $${poTotal(po).toFixed(2)}`.trim()} sub={`received $${poReceivedTotal(po).toFixed(2)}`} />
                <StatusBadge className={cn(STATUS_STYLE[po.status])}>{po.status}</StatusBadge>
                <td className="px-2 py-2.5">
                  <RowActions>
                    <IconBtn title={expanded[po.id] ? 'Hide lines' : 'View lines + receive'} onClick={() => setExpanded((e) => ({ ...e, [po.id]: !e[po.id] }))}>
                      <Eye className="h-3.5 w-3.5" />
                    </IconBtn>
                    {(po.status === 'draft' || po.status === 'ordered') && (
                      <IconBtn title="Email purchase order to supplier" tone="green" onClick={() => openPoEmail(po)}>
                        <Send className="h-3 w-3" />
                      </IconBtn>
                    )}
                    {po.status === 'draft' && (
                      <IconBtn title="Mark as ordered (sent to supplier)" tone="green" onClick={() => setStatus(po.id, 'ordered')}>
                        <Check className="h-3.5 w-3.5" />
                      </IconBtn>
                    )}
                    {po.status === 'received' && (
                      <IconBtn title="Create the vendor bill (match holds)" tone="green" disabled={busy} onClick={() => callBill(po)}>
                        <ReceiptText className="h-3.5 w-3.5" />
                      </IconBtn>
                    )}
                    {voidable && (
                      <IconBtn title="Void order (kept for audit)" tone="amber" onClick={() => setStatus(po.id, 'void')}>
                        <Ban className="h-3 w-3" />
                      </IconBtn>
                    )}
                    {(po.status === 'draft' || po.status === 'void') && (
                      <IconBtn title="Delete order" tone="red" onClick={() => deletePurchaseOrder(po.id)}>
                        <Trash2 className="h-3 w-3" />
                      </IconBtn>
                    )}
                  </RowActions>
                </td>
              </tr>
              {expanded[po.id] && (
                <tr key={`${po.id}-detail`} className="border-b bg-muted/20 last:border-0">
                  <td colSpan={6} className="px-4 py-2 text-sm">
                    {!match.ok && po.status !== 'draft' && <p className="text-xs text-amber-600">Waiting on: {match.reasons.join('; ')}</p>}
                    {match.ok && po.status === 'received' && <p className="text-xs text-emerald-600">✓ Order, delivery & bill all agree — ready to bill.</p>}
                    {po.lines.map((l, i) => (
                      <div key={i} className="flex items-center gap-2 py-0.5 text-muted-foreground">
                        <span>{l.label} × {l.qty} @ ${l.unitCost} (received {l.receivedQty ?? 0})</span>
                        {(po.status === 'ordered' || po.status === 'partial') && (
                          <label className="flex items-center gap-1 text-xs">Arrived:
                            <Input
                              className="w-20"
                              placeholder="0"
                              value={recv[po.id]?.[i] ?? ''}
                              onChange={(e) => setRecv((m) => ({ ...m, [po.id]: { ...(m[po.id] ?? {}), [i]: e.target.value } }))}
                            />
                          </label>
                        )}
                      </div>
                    ))}
                    {(po.status === 'ordered' || po.status === 'partial') && (
                      <Button size="sm" className="mt-1" disabled={busy} onClick={() => callReceive(po)}>Receive these goods</Button>
                    )}
                    {po.billId && <p className="mt-1 text-xs">Billed → {po.billId} — see Vendors & AP.</p>}
                    {po.notes && <p className="mt-1 text-xs">Note to supplier: {po.notes}</p>}
                  </td>
                </tr>
              )}
            </>
          );
        })}
        {visible.length === 0 && <EmptyRow colSpan={6}>{purchaseOrders.length === 0 ? 'No orders yet — click “＋ New purchase order”. Pick a vendor, add what you need, and mark it ordered.' : 'No orders match this filter.'}</EmptyRow>}
      </CrudTable>
      <FormDialog
        open={showNew}
        onOpenChange={setShowNew}
        title="New purchase order"
        description="Tell a supplier what you need. Receiving later puts it on your shelves at what you paid."
        submitLabel="Create draft"
        onSubmit={create}
        wide
      >
        <FieldGrid cols={3}>
          <Field label="Supplier" hint="New supplier? Add them under Finance → Vendors first.">
            <SearchSelect
              options={vendors.map((v) => ({ value: v.id, label: v.name, detail: v.service }))}
              value={vendorId}
              onChange={(v) => setVendorId(v)}
              placeholder="Search suppliers…"
              searchPlaceholder="Search suppliers"
            />
          </Field>
          <Field label="Order currency" hint={currency && currency.toUpperCase() !== wsCurrency ? `Converts to ${wsCurrency} on the bill.` : `Same as the company (${wsCurrency}).`}>
            <CurrencySelect value={currency || wsCurrency} onChange={(v) => setCurrency(v === wsCurrency ? '' : v)} />
          </Field>
          <TextField label="Expected delivery" value={expectedIso} onChange={setExpectedIso} type="date" hint="When should the boxes arrive?" />
        </FieldGrid>
        <Field label="What are you ordering?" hint="Pick from your catalog (cost fills in) or type a free-text line.">
          <div className="space-y-1.5">
            <div className="grid grid-cols-[1fr_1fr_96px_64px_96px_32px] gap-1 text-[11px] text-muted-foreground">
              <span>Catalog item</span><span>Description</span><span>Qty</span><span>Unit cost</span><span>Line total</span><span />
            </div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_96px_64px_96px_32px] items-center gap-1">
                <SearchSelect
                  options={[
                    { value: '', label: 'Free text…' },
                    ...inventoryItems.filter((x) => x.type === 'product' && x.active).map((x) => ({ value: x.id, label: x.name, detail: `$${x.costPrice}` })),
                  ]}
                  value={l.itemId ?? ''}
                  onChange={(v) => {
                    const item = inventoryItems.find((x) => x.id === v);
                    setLines((ls) => ls.map((x, j) => (j === i ? { ...x, itemId: item?.id, label: item ? item.name : x.label, unitCost: item ? item.costPrice : x.unitCost } : x)));
                  }}
                  placeholder="Free text…"
                  searchPlaceholder="Search catalog"
                  clearable={false}
                />
                <Input placeholder="What do you need?" value={l.label} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <Input placeholder="1" value={String(l.qty)} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) || 0 } : x)))} />
                <Input placeholder="0.00" value={String(l.unitCost)} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unitCost: Number(e.target.value) || 0 } : x)))} />
                <span className="text-sm text-muted-foreground">${(l.qty * l.unitCost).toFixed(2)}</span>
                <Button variant="ghost" size="sm" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>×</Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { label: '', qty: 1, unitCost: 0 }])}>Add a line</Button>
          </div>
        </Field>
        <NotesField label="Note to supplier" value={poNotes} onChange={setPoNotes} placeholder="Delivery instructions, dock hours, call on arrival…" />
        <p className="text-xs text-muted-foreground">Receives into: {warehouses.find((w) => w.active)?.name ?? warehouses[0]?.name ?? 'no warehouse yet — create one under Inventory → Warehouses first'}</p>
      </FormDialog>

      <DocumentEmailDialog
        open={!!emailPo}
        onOpenChange={(o) => {
          if (!o) {
            setEmailPo(null);
            setEmailTarget(null);
          }
        }}
        ws={activeWorkspaceId}
        target={emailTarget}
        onSent={(_via, to) => {
          if (emailPo) {
            if (emailPo.status === 'draft') {
              upsertPurchaseOrder({ ...emailPo, status: 'ordered' });
            }
            log({ agentId: 'a-ops', agentName: 'Vega', actor: 'user', kind: 'task', message: `Purchase order ${emailPo.number} emailed to ${to}.` });
            setMsg(`Purchase order ${emailPo.number} emailed to ${to} and marked ordered.`);
          }
        }}
      />
    </div>
  );
}
