'use client';
import { useState } from 'react';
import { Eye, Send, Check, Pencil, Trash2, ReceiptText } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SectionTitle } from '../bits';
import { useBorga } from '@/lib/borga/store';
import { quoteSubtotal, quoteDiscount, quoteTax, quoteTotal, isExpired, nextVersion, type Quote, type QuoteLine, type QuoteStatus } from '@/lib/borga/quotes';
import { FormDialog, Field, FieldGrid, TextField, NotesField } from '../form-kit';
import { CurrencySelect } from '../form-widgets';
import { SearchSelect } from '../SearchSelect';
import { FilterPills, TableSearch, TableToolbar, CrudTable, IdCell, TextCell, AmountCell, StatusBadge, EmptyRow, IconBtn, RowActions } from '../data-table';
import { DocumentEmailDialog, type DocumentEmailTarget } from '../DocumentEmailDialog';
import { cn } from '@/lib/utils';

const STATUS_STYLE: Record<QuoteStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  sent: 'bg-sky-500/10 text-sky-600',
  accepted: 'bg-emerald-500/10 text-emerald-600',
  expired: 'bg-amber-500/10 text-amber-600',
  converted: 'bg-violet-500/10 text-violet-600',
};

const emptyLine = (): QuoteLine => ({ label: '', qty: 1, unitPrice: 0, taxRate: 0 });

export function QuotesTab() {
  const { quotes, upsertQuote, deleteQuote, customers, inventoryItems, activeWorkspace, activeWorkspaceId, hydrate, leads, moveLeadStage, log } = useBorga();
  const wsCurrency = activeWorkspace()?.currency ?? 'USD';
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Quote | null>(null);
  const [customerId, setCustomerId] = useState('');
  const [manualCustomer, setManualCustomer] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [currency, setCurrency] = useState('');
  const [lines, setLines] = useState<QuoteLine[]>([emptyLine()]);
  const [discountPct, setDiscountPct] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [validUntil, setValidUntil] = useState(new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [emailQuote, setEmailQuote] = useState<Quote | null>(null);
  const [emailTarget, setEmailTarget] = useState<DocumentEmailTarget | null>(null);

  const openNew = () => {
    setEditing(null); setCustomerId(''); setManualCustomer(''); setCustomerEmail(''); setCurrency('');
    setLines([emptyLine()]); setDiscountPct(''); setPaymentTerms('');
    setValidUntil(new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)); setNotes('');
    setShowNew(true);
  };
  const openEdit = (q: Quote) => {
    setEditing(q);
    setCustomerId(customers.some((c) => c.id === q.customerId) ? q.customerId : '');
    setManualCustomer(customers.some((c) => c.id === q.customerId) ? '' : q.customerName);
    setCustomerEmail(q.customerEmail ?? '');
    setCurrency(q.currency ?? '');
    setLines(q.lines.map((l) => ({ ...l })));
    setDiscountPct(q.discountPct ? String(q.discountPct) : '');
    setPaymentTerms(q.paymentTerms ?? '');
    setValidUntil(q.validUntil); setNotes(q.notes ?? '');
    setShowNew(true);
  };

  const preview: Quote = {
    id: editing?.id ?? 'preview', number: editing?.number ?? `Q-${quotes.length + 1}`,
    customerId: 'preview', customerName: 'preview', lines: lines.filter((l) => l.label.trim() && l.qty > 0),
    status: 'draft', version: editing?.version ?? 1,
    issued: '', validUntil, discountPct: Number(discountPct) || undefined,
  };

  const save = () => {
    const cust = customers.find((c) => c.id === customerId);
    const name = cust?.name ?? manualCustomer.trim();
    const clean = lines.filter((l) => l.label.trim() && l.qty > 0);
    if (!name || clean.length === 0) { setMsg('Pick a customer (or type a name) and add at least one line.'); return; }
    const base = {
      customerId: cust?.id ?? editing?.customerId ?? `manual-${Date.now().toString(36)}`,
      customerName: name, customerEmail: customerEmail.trim() || undefined,
      currency: currency.trim().toUpperCase() && currency.trim().toUpperCase() !== wsCurrency ? currency.trim().toUpperCase() : undefined,
      lines: clean, validUntil, notes: notes.trim() || undefined,
      discountPct: Number(discountPct) || undefined,
      paymentTerms: paymentTerms.trim() || undefined,
    };
    if (editing) {
      upsertQuote({ ...editing, ...base });
      setMsg(`Draft ${editing.number} updated.`);
    } else {
      const q: Quote = {
        ...base, id: `q-${Date.now().toString(36)}`, number: `Q-${quotes.length + 1}`,
        status: 'draft', version: 1, issued: new Date().toISOString().slice(0, 10),
      };
      upsertQuote(q);
      setMsg(`Draft ${q.number} created — send it, then accept to write invoice + project.`);
    }
    setShowNew(false); setEditing(null);
  };

  const openQuoteEmail = (id: string) => {
    const q = quotes.find((x) => x.id === id);
    if (!q) return;
    const cust = customers.find((c) => c.id === q.customerId || c.name.toLowerCase() === q.customerName.toLowerCase());
    const recipientEmail = q.customerEmail || cust?.email || '';
    const wsName = activeWorkspace()?.legalName ?? activeWorkspace()?.name ?? 'Our Team';
    const cur = q.currency ?? wsCurrency;
    const total = quoteTotal(q);
    setEmailQuote(q);
    setEmailTarget({
      to: recipientEmail,
      subject: `Quote ${q.number} from ${wsName}`,
      body: `Hi ${q.customerName},\n\nPlease find attached our quote ${q.number} for ${cur} ${total.toFixed(2)}, valid until ${q.validUntil}.${q.paymentTerms ? `\n\nPayment terms: ${q.paymentTerms}` : ''}${q.notes ? `\n\nNotes: ${q.notes}` : ''}\n\nLet us know if you have any questions or would like to proceed.\n\nKind regards,\n${wsName}`,
      document: {
        kind: 'quote',
        workspaceName: wsName,
        documentNumber: `${q.number} (v${q.version})`,
        recipientName: q.customerName,
        currency: cur,
        totalAmount: total,
        subtotalAmount: quoteSubtotal(q),
        discountAmount: quoteDiscount(q),
        taxAmount: quoteTax(q),
        issuedDate: q.issued,
        dueOrValidDate: q.validUntil,
        lines: q.lines.map((l) => ({
          label: l.label,
          qty: l.qty,
          unitPrice: l.unitPrice,
          amount: l.qty * l.unitPrice,
        })),
      },
    });
  };

  const version = (id: string) => {
    const q = quotes.find((x) => x.id === id);
    if (q) upsertQuote(nextVersion(q));
  };

  const accept = async (id: string, target: 'invoice' | 'project' | 'both') => {
    setBusy((b) => ({ ...b, [id]: true })); setMsg(null);
    try {
      const r = await fetch('/api/borga/quotes/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ ws: activeWorkspaceId, quoteId: id, target }),
      });
      const d = await r.json() as { ok?: boolean; error?: string; invoiceId?: string; projectId?: string; total?: number };
      if (d.ok) {
        const q = quotes.find((x) => x.id === id);
        if (q) upsertQuote({ ...q, status: 'converted', convertedInvoiceId: d.invoiceId, convertedProjectId: d.projectId });
        // Close the loop on the originating lead: its quote became money.
        if (q?.leadId && leads.some((l) => l.id === q.leadId && l.stage !== 'won')) {
          moveLeadStage(q.leadId, 'won', `Quote ${q.number} accepted${d.invoiceId ? ` → invoice ${d.invoiceId}` : ''}.`);
          log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'system', kind: 'system', message: `Lead ${leads.find((l) => l.id === q.leadId)?.name ?? ''} won: quote ${q.number} accepted.`, ref: { kind: 'lead', id: q.leadId } });
        }
        setMsg(`Accepted → invoice ${d.invoiceId ?? '—'} + project ${d.projectId ?? '—'} (${d.total}). Invoicing and Projects updated.`);
        void hydrate();
      } else setMsg(`Accept failed: ${d.error}`);
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };

  const [filter, setFilter] = useState<'all' | QuoteStatus>('all');
  const [query, setQuery] = useState('');

  const shownOf = (q: Quote): QuoteStatus => (q.status === 'sent' && isExpired(q) ? 'expired' : q.status);
  const visible = quotes
    .filter((q) => (filter === 'all' ? true : shownOf(q) === filter))
    .filter((q) => (query ? `${q.number} ${q.customerName} ${q.customerEmail ?? ''}`.toLowerCase().includes(query.toLowerCase()) : true));

  return (
    <div className="space-y-4">
      <SectionTitle title="Quotes & estimates" sub="Send a price to a customer. If they say yes, one click turns it into the invoice (and project)." />
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
      <Card className="p-4">
        <p className="text-sm font-semibold">How this works (3 steps)</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-muted-foreground">
          <li><strong className="text-foreground">Draft</strong> the price with line items below.</li>
          <li><strong className="text-foreground">Send</strong> it — the customer gets a proper quote with an expiry date.</li>
          <li><strong className="text-foreground">Accept</strong> when they say yes — the invoice (and a project for the work) is created for you.</li>
        </ol>
        <p className="mt-1 text-xs text-muted-foreground">💡 Tip: a 30-day expiry date gently pushes customers to decide. Changed something? “New version” keeps the history.</p>
      </Card>
      <TableToolbar>
        <FilterPills options={['all', 'draft', 'sent', 'accepted', 'expired', 'converted'] as const} value={filter} onChange={setFilter} />
        <TableSearch value={query} onChange={setQuery} placeholder="Search quotes…" />
        <Button onClick={openNew}>＋ New quote</Button>
      </TableToolbar>
      <CrudTable headers={['Quote', 'Customer', 'Issued → Valid', <span key="a" className="block text-right">Amount</span>, 'Status']}>
        {visible.map((q) => {
          const shown = shownOf(q);
          const deletable = q.status === 'draft' || shown === 'expired';
          return (
            <>
              <tr key={q.id} className="border-b last:border-0 hover:bg-muted/20">
                <IdCell sub={`v${q.version}`}>{q.number}</IdCell>
                <TextCell sub={q.customerEmail}>{q.customerName}</TextCell>
                <TextCell>{q.issued} → {q.validUntil}</TextCell>
                <AmountCell value={`${q.currency ?? ''} $${quoteTotal(q).toFixed(2)}`.trim()} sub={q.discountPct ? `${q.discountPct}% discount` : (q.status === 'converted' ? 'accepted ✓' : undefined)} />
                <StatusBadge className={cn(STATUS_STYLE[shown])}>{shown}</StatusBadge>
                <td className="px-2 py-2.5">
                  <RowActions>
                    <IconBtn title={expanded[q.id] ? 'Hide lines' : 'View lines'} onClick={() => setExpanded((e) => ({ ...e, [q.id]: !e[q.id] }))}>
                      <Eye className="h-3.5 w-3.5" />
                    </IconBtn>
                    {(q.status === 'draft' || q.status === 'sent') && (
                      <IconBtn title="Email quote to customer" tone="green" onClick={() => openQuoteEmail(q.id)}>
                        <Send className="h-3 w-3" />
                      </IconBtn>
                    )}
                    {(q.status === 'sent' || q.status === 'draft') && (
                      <IconBtn title="New version (keeps history)" onClick={() => version(q.id)}>
                        <span className="text-[10px] font-bold">v+</span>
                      </IconBtn>
                    )}
                    {deletable && (
                      <IconBtn title="Edit draft" onClick={() => openEdit(q)}>
                        <Pencil className="h-3 w-3" />
                      </IconBtn>
                    )}
                    {q.status === 'sent' && shown !== 'expired' && (
                      <>
                        <IconBtn title="Customer said yes → invoice only" tone="green" disabled={busy[q.id]} onClick={() => accept(q.id, 'invoice')}>
                          <ReceiptText className="h-3.5 w-3.5" />
                        </IconBtn>
                        <IconBtn title="Customer said yes → invoice + project" tone="green" disabled={busy[q.id]} onClick={() => accept(q.id, 'both')}>
                          <Check className="h-3.5 w-3.5" />
                        </IconBtn>
                      </>
                    )}
                    {deletable && (
                      <IconBtn title={q.status === 'draft' ? 'Delete draft' : 'Delete expired quote'} tone="red" onClick={() => deleteQuote(q.id)}>
                        <Trash2 className="h-3 w-3" />
                      </IconBtn>
                    )}
                  </RowActions>
                </td>
              </tr>
              {expanded[q.id] && (
                <tr key={`${q.id}-detail`} className="border-b bg-muted/20 last:border-0">
                  <td colSpan={6} className="px-4 py-2 text-sm">
                    {q.lines.map((l, i) => (
                      <p key={i} className="text-muted-foreground">{l.label} × {l.qty} @ ${l.unitPrice}{l.taxRate ? ` (+${l.taxRate}% tax)` : ''}</p>
                    ))}
                    {q.paymentTerms && <p className="mt-1">Terms: {q.paymentTerms}</p>}
                    {q.notes && <p className="mt-1">{q.notes}</p>}
                    {q.convertedInvoiceId && <p className="mt-1 text-xs">Converted → invoice {q.convertedInvoiceId}{q.convertedProjectId ? ` + project ${q.convertedProjectId}` : ''}</p>}
                    {shown === 'expired' && <p className="mt-1 text-xs text-amber-600">Past its date — send a new version instead of editing.</p>}
                  </td>
                </tr>
              )}
            </>
          );
        })}
        {visible.length === 0 && <EmptyRow colSpan={6}>{quotes.length === 0 ? 'No quotes yet — click “＋ New quote” above. A good first quote: one customer, 2–3 lines, 30-day expiry.' : 'No quotes match this filter.'}</EmptyRow>}
      </CrudTable>
      <FormDialog
        open={showNew}
        onOpenChange={(o) => { setShowNew(o); if (!o) setEditing(null); }}
        title={editing ? `Edit ${editing.number} (v${editing.version} draft)` : 'New quote'}
        description={editing ? 'Change anything while it is still a draft. Sending locks the version.' : 'Price a job for a customer. Totals add up as you type.'}
        submitLabel={editing ? 'Save changes' : 'Create draft'}
        onSubmit={save}
        wide
      >
        <FieldGrid cols={2}>
          <Field label="Customer" hint="Search your customers — or type a new name to use it just for this quote.">
            <SearchSelect
              options={customers.map((c) => ({ value: c.id, label: c.name, detail: c.industry }))}
              value={customerId}
              onChange={(v, option) => {
                const picked = customers.find((c) => c.id === v);
                if (picked) {
                  setCustomerId(picked.id);
                  setManualCustomer('');
                  // Address the quote where their invoices go, unless already typed.
                  setCustomerEmail((prev) => prev || picked.email || '');
                } else {
                  setCustomerId('');
                  setManualCustomer(option?.label ?? v);
                }
              }}
              placeholder="Search customers or type a name…"
              searchPlaceholder="Search customers"
              allowCustom
            />
          </Field>
          <TextField label="Customer email" value={customerEmail} onChange={setCustomerEmail} placeholder="Accounts-payable email" type="email" hint="Filled from the customer — override per quote." />
        </FieldGrid>
        <FieldGrid cols={2}>
          <Field label="Quoting currency" hint={currency && currency.toUpperCase() !== wsCurrency ? `Converts to ${wsCurrency} at the FX table rate on accept.` : `Same as the company (${wsCurrency}) — no conversion.`}>
            <CurrencySelect value={currency || wsCurrency} onChange={(v) => setCurrency(v === wsCurrency ? '' : v)} />
          </Field>
          <TextField label="Good until" value={validUntil} onChange={setValidUntil} type="date" hint="30 days is normal — it nudges decisions." />
        </FieldGrid>
        <Field label="Line items" hint="Pick from your catalog (price fills in) or type a free-text line.">
          <div className="space-y-1.5">
            <div className="grid grid-cols-[1fr_1fr_64px_96px_64px_32px] gap-1 text-[11px] text-muted-foreground">
              <span>Catalog item</span><span>Description</span><span>Qty</span><span>Unit price</span><span>Tax %</span><span />
            </div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_64px_96px_64px_32px] gap-1">
                <SearchSelect
                  options={[
                    { value: '', label: 'Free text…' },
                    ...inventoryItems.filter((x) => x.active).map((x) => ({ value: x.id, label: x.name, detail: `$${x.price}` })),
                  ]}
                  value={l.itemId ?? ''}
                  onChange={(v) => {
                    const item = inventoryItems.find((x) => x.id === v);
                    setLines((ls) => ls.map((x, j) => (j === i
                      ? { ...x, itemId: item?.id, label: item ? item.name : x.label, unitPrice: item ? item.price : x.unitPrice, taxRate: item ? item.taxRate : x.taxRate }
                      : x)));
                  }}
                  placeholder="Free text…"
                  searchPlaceholder="Search catalog"
                  clearable={false}
                />
                <Input placeholder="What are you selling?" value={l.label} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, label: e.target.value, itemId: undefined } : x)))} />
                <Input placeholder="1" value={String(l.qty)} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) || 0 } : x)))} />
                <Input placeholder="0.00" value={String(l.unitPrice)} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unitPrice: Number(e.target.value) || 0 } : x)))} />
                <Input placeholder="0" value={String(l.taxRate ?? 0)} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, taxRate: Number(e.target.value) || 0 } : x)))} />
                <Button variant="ghost" size="sm" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>×</Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}>Add a line</Button>
          </div>
        </Field>
        <FieldGrid cols={2}>
          <TextField label="Discount %" value={discountPct} onChange={setDiscountPct} placeholder="0" type="number" hint="Taken off the subtotal, before tax." />
          <TextField label="Payment terms" value={paymentTerms} onChange={setPaymentTerms} placeholder="e.g. 50% deposit, balance on delivery" />
        </FieldGrid>
        <NotesField label="Notes for the customer" value={notes} onChange={setNotes} placeholder="Anything they should know — timeline, warranty, what's not included…" />
        <div className="rounded-lg bg-muted/40 p-3 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>${quoteSubtotal(preview).toFixed(2)}</span></div>
          {quoteDiscount(preview) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span>−${quoteDiscount(preview).toFixed(2)}</span></div>}
          <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>${quoteTax(preview).toFixed(2)}</span></div>
          <div className="flex justify-between font-semibold"><span>Total</span><span>${quoteTotal(preview).toFixed(2)}</span></div>
        </div>
      </FormDialog>

      <DocumentEmailDialog
        open={!!emailQuote}
        onOpenChange={(o) => {
          if (!o) {
            setEmailQuote(null);
            setEmailTarget(null);
          }
        }}
        ws={activeWorkspaceId}
        target={emailTarget}
        onSent={(_via, to) => {
          if (emailQuote) {
            upsertQuote({ ...emailQuote, customerEmail: to || emailQuote.customerEmail, status: emailQuote.status === 'draft' ? 'sent' : emailQuote.status });
            log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'user', kind: 'task', message: `Quote ${emailQuote.number} emailed to ${to}.` });
            setMsg(`Quote ${emailQuote.number} sent to ${to}.`);
          }
        }}
      />
    </div>
  );
}
