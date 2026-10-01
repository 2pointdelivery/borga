'use client';

import { fmtMoney } from '@/lib/borga/currencies';
import { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Building2,
  Globe,
  Phone,
  Mail,
  MapPin,
  UserPlus,
  X,
  Star,
  Download,
  FolderKanban,
  CheckSquare,
  ArrowUpRight,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CUSTOMER_STATUS_STYLE,
  INVOICE_STATUS_STYLE,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_STYLE,
  computeProjectActualSpend,
    type Customer,
  type Contact,
  type CustomerStatus,
} from '@/lib/borga/data';
import { useBorga } from '@/lib/borga/store';
import { AgentAvatar, SectionTitle } from '../bits';
import { CityInput, CountrySelect, Field, IndustryInput, RegionSelect } from '../form-widgets';
import { cn } from '@/lib/utils';

interface CustomerForm {
  name: string; industry: string; website: string; email: string; phone: string;
  addressLine: string; city: string; state: string; country: string;
  status: CustomerStatus; owner: string; notes: string;
}

const EMPTY_CUSTOMER: CustomerForm = {
  name: '', industry: '', website: '', email: '', phone: '',
  addressLine: '', city: '', state: '', country: '', status: 'prospect', owner: '', notes: '',
};

// Module-level id generator keeps impure clock access out of component bodies.
let idSeq = 0;
function nextId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSeq}`;
}

export function CustomerTab() {
  const {
    customers, addCustomer, updateCustomer, deleteCustomer,
    contacts, addContact, updateContact, deleteContact,
    leads, updateLead, invoices, updateInvoice, agents, log, activeWorkspace,
    projects, tasks, addTask, finance,
  } = useBorga();

  const currency = activeWorkspace()?.currency ?? 'USD';
  const money = (n: number) => fmtMoney(n, currency);

  const [selectedId, setSelectedId] = useState<string | null>(customers[0]?.id ?? null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | CustomerStatus>('all');

  const [custDialogOpen, setCustDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [custForm, setCustForm] = useState<CustomerForm>(EMPTY_CUSTOMER);
  const [confirmDelete, setConfirmDelete] = useState<Customer | null>(null);

  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [contactForm, setContactForm] = useState({ name: '', title: '', email: '', phone: '', primary: false });
  const [taskDraft, setTaskDraft] = useState('');

  const filtered = useMemo(
    () =>
      customers.filter((c) => {
        if (statusFilter !== 'all' && c.status !== statusFilter) return false;
        if (query && !`${c.name} ${c.industry} ${c.city} ${c.owner}`.toLowerCase().includes(query.toLowerCase())) return false;
        return true;
      }),
    [customers, statusFilter, query],
  );

  useEffect(() => {
    if (!filtered.some((c) => c.id === selectedId)) setSelectedId(filtered[0]?.id ?? null);
  }, [filtered, selectedId]);

  const selected = customers.find((c) => c.id === selectedId) ?? null;
  const selectedContacts = contacts.filter((ct) => ct.customerId === selectedId);

  // Matches by real customerId first; falls back to legacy name-matching only
  // for records created before the FK existed, so old data keeps working while
  // every new link is a real reference instead of a fuzzy string comparison.
  // The fallback requires an exact (case-insensitive) name match — a partial/
  // first-word match previously conflated unrelated companies that happen to
  // share a word (e.g. "Northwind Studio" vs "Northwind Logistics").
  const accountStats = useMemo(() => {
    if (!selected) return null;
    const nameMatch = (name: string) => name.toLowerCase() === selected.name.toLowerCase();
    const allInvoices = invoices.filter((i) => (i.customerId ? i.customerId === selected.id : nameMatch(i.client)));
    const openInvoices = allInvoices.filter((i) => i.status !== 'paid' && i.status !== 'draft');
    const relatedDeals = leads.filter((l) => (l.customerId ? l.customerId === selected.id : nameMatch(l.company)));
    const openValue = openInvoices.reduce((s, i) => s + i.amount, 0);
    const pipelineValue = relatedDeals.filter((d) => d.stage !== 'won' && d.stage !== 'lost').reduce((s, d) => s + d.value, 0);
    const wonValue = relatedDeals.filter((d) => d.stage === 'won').reduce((s, d) => s + d.value, 0);
    const ownerAgent = agents.find((a) => a.name === selected.owner);
    return { openInvoices, allInvoices, relatedDeals, openValue, pipelineValue, wonValue, ownerAgent };
  }, [selected, invoices, leads, agents]);

  const relatedProjects = useMemo(() => projects.filter((p) => p.customerId === selectedId), [projects, selectedId]);
  const relatedTasks = useMemo(() => tasks.filter((t) => t.customerId === selectedId), [tasks, selectedId]);

  const openProject = (projectId: string) => {
    window.dispatchEvent(new CustomEvent('borga:nav', { detail: { page: 'projects', tab: projectId } }));
  };

  const addAccountTask = () => {
    if (!selected || !taskDraft.trim()) return;
    addTask({
      id: `t-${Date.now()}`,
      title: taskDraft.trim(),
      detail: '',
      priority: 'P2',
      status: 'todo',
      bucket: 'week',
      assignee: agents.find((a) => a.name === selected.owner)?.name ?? 'Borga',
      tags: [],
      due: '…',
      progress: 0,
      customerId: selected.id,
    });
    setTaskDraft('');
    log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'user', kind: 'task', message: `Task added for ${selected.name}: ${taskDraft.trim()}.` });
  };

  const submitCustomer = () => {
    if (!custForm.name.trim()) return;
    if (editingCustomer) {
      updateCustomer(editingCustomer.id, {
        name: custForm.name.trim(),
        industry: custForm.industry.trim(),
        website: custForm.website.trim(),
        email: custForm.email.trim(),
        phone: custForm.phone.trim(),
        addressLine: custForm.addressLine.trim(),
        city: custForm.city.trim(),
        country: custForm.country.trim(),
        status: custForm.status,
        owner: custForm.owner.trim(),
        notes: custForm.notes.trim(),
      });
      log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'user', kind: 'task', message: `Customer account updated: ${custForm.name.trim()}.` });
    } else {
      const c: Customer = {
        id: nextId('cust'),
        name: custForm.name.trim(),
        industry: custForm.industry.trim() || 'General',
        website: custForm.website.trim(),
        email: custForm.email.trim(),
        phone: custForm.phone.trim(),
        addressLine: custForm.addressLine.trim(),
        city: custForm.city.trim(),
        country: custForm.country.trim(),
        status: custForm.status,
        owner: custForm.owner.trim() || 'Unassigned',
        createdAt: new Date().toLocaleDateString([], { month: 'short', year: 'numeric' }),
        notes: custForm.notes.trim(),
      };
      addCustomer(c);
      log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'user', kind: 'task', message: `New customer account created: ${c.name}.` });
      setSelectedId(c.id);
    }
    setCustDialogOpen(false);
    setEditingCustomer(null);
  };

  const submitContact = () => {
    if (!selected || !contactForm.name.trim()) return;
    if (editingContact) {
      updateContact(editingContact.id, {
        name: contactForm.name.trim(),
        title: contactForm.title.trim(),
        email: contactForm.email.trim(),
        phone: contactForm.phone.trim(),
      });
      if (contactForm.primary && !editingContact.primary) {
        contacts.filter((ct) => ct.customerId === selected.id && ct.id !== editingContact.id).forEach((ct) => updateContact(ct.id, { primary: false }));
        updateContact(editingContact.id, { primary: true });
      }
      log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'user', kind: 'task', message: `Contact updated at ${selected.name}: ${contactForm.name.trim()}.` });
    } else {
      if (contactForm.primary) {
        selectedContacts.forEach((ct) => { if (ct.primary) updateContact(ct.id, { primary: false }); });
      }
      addContact({
        id: nextId('ct'),
        customerId: selected.id,
        name: contactForm.name.trim(),
        title: contactForm.title.trim(),
        email: contactForm.email.trim(),
        phone: contactForm.phone.trim(),
        primary: contactForm.primary || selectedContacts.length === 0,
      });
      log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'user', kind: 'task', message: `Contact added at ${selected.name}: ${contactForm.name.trim()}.` });
    }
    setContactDialogOpen(false);
    setEditingContact(null);
  };

  const exportCsv = () => {
    const rows = [
      ['name', 'industry', 'status', 'owner', 'email', 'phone', 'city', 'country', 'contacts'],
      ...filtered.map((c) => [
        c.name, c.industry, c.status, c.owner, c.email, c.phone,
        c.city, c.country,
        String(contacts.filter((ct) => ct.customerId === c.id).length),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'user', kind: 'sync', message: `${filtered.length} customer accounts exported.` });
  };

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Customers" sub={`${customers.length} accounts — ${contacts.length} contacts — full account information`} />
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv}>
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button onClick={() => { setEditingCustomer(null); setCustForm(EMPTY_CUSTOMER); setCustDialogOpen(true); }}>
            <Plus className="h-4 w-4" /> New customer
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        {/* List */}
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search accounts…" className="pl-8" />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="prospect">Prospect</option>
              <option value="churned">Churned</option>
            </select>
          </div>
          <Card className="max-h-[560px] overflow-y-auto">
            {filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={cn(
                  'flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors last:border-0',
                  selectedId === c.id ? 'bg-accent' : 'hover:bg-muted/30',
                )}
              >
                <span
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold text-white"
                  style={{ background: '#6366f1' }}
                >
                  {c.name.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{c.industry} — {c.city}</p>
                </div>
                <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ring-1', CUSTOMER_STATUS_STYLE[c.status])}>
                  {c.status}
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="py-10 text-center text-xs text-muted-foreground">No accounts match.</p>
            )}
          </Card>
        </div>

        {/* Detail */}
        {selected ? (
          <div className="space-y-4">
            <Card className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white" style={{ background: '#6366f1' }}>
                    {selected.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div>
                    <p className="text-base font-semibold">{selected.name}</p>
                    <p className="text-xs text-muted-foreground">{selected.industry} — customer since {selected.createdAt}</p>
                    <div className="mt-1.5 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                      {selected.website && (
                        <a href={`https://${selected.website.replace(/^https?:\/\//, '')}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-foreground hover:underline">
                          <Globe className="h-3 w-3" /> {selected.website}
                        </a>
                      )}
                      {selected.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {selected.email}</span>}
                      {selected.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {selected.phone}</span>}
                      {(selected.addressLine || selected.city) && (
                        <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {[selected.addressLine, selected.city, selected.country].filter(Boolean).join(', ')}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium ring-1', CUSTOMER_STATUS_STYLE[selected.status])}>
                    {selected.status}
                  </span>
                  <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => {
                    setEditingCustomer(selected);
                    setCustForm({
                      name: selected.name, industry: selected.industry, website: selected.website,
                      email: selected.email, phone: selected.phone, addressLine: selected.addressLine,
                      city: selected.city, state: selected.state ?? '', country: selected.country, status: selected.status,
                      owner: selected.owner, notes: selected.notes,
                    });
                    setCustDialogOpen(true);
                  }}>
                    <Pencil className="h-3 w-3" /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-destructive" onClick={() => setConfirmDelete(selected)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              {selected.notes && (
                <div className="mt-4 rounded-xl border bg-muted/20 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Account notes</p>
                  <p className="mt-1 text-sm leading-relaxed">{selected.notes}</p>
                </div>
              )}

              {accountStats && (
                <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                  <div className="rounded-lg bg-muted/20 p-2.5">
                    <p className="text-[10px] text-muted-foreground">Open invoices</p>
                    <p className="text-sm font-semibold">{money(accountStats.openValue)}</p>
                    <p className="text-[10px] text-muted-foreground">{accountStats.openInvoices.length} unpaid</p>
                  </div>
                  <div className="rounded-lg bg-muted/20 p-2.5">
                    <p className="text-[10px] text-muted-foreground">Open pipeline</p>
                    <p className="text-sm font-semibold">{money(accountStats.pipelineValue)}</p>
                    <p className="text-[10px] text-muted-foreground">{accountStats.relatedDeals.filter((d) => d.stage !== 'won' && d.stage !== 'lost').length} deals</p>
                  </div>
                  <div className="rounded-lg bg-muted/20 p-2.5">
                    <p className="text-[10px] text-muted-foreground">Closed-won</p>
                    <p className="text-sm font-semibold">{money(accountStats.wonValue)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/20 p-2.5">
                    <p className="text-[10px] text-muted-foreground">Account owner</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      {accountStats.ownerAgent && <AgentAvatar name={accountStats.ownerAgent.name} color={accountStats.ownerAgent.avatarColor} size={18} />}
                      <p className="truncate text-xs font-medium">{selected.owner}</p>
                    </div>
                  </div>
                </div>
              )}
            </Card>

            {/* Contacts */}
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2.5">
                <div>
                  <p className="text-sm font-semibold">Contacts ({selectedContacts.length})</p>
                  <p className="text-[11px] text-muted-foreground">People at {selected.name}</p>
                </div>
                <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => { setEditingContact(null); setContactForm({ name: '', title: '', email: '', phone: '', primary: false }); setContactDialogOpen(true); }}>
                  <UserPlus className="h-3 w-3" /> Add contact
                </Button>
              </div>
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="hidden px-4 py-2 font-medium sm:table-cell">Title</th>
                    <th className="hidden px-4 py-2 font-medium md:table-cell">Email</th>
                    <th className="hidden px-4 py-2 font-medium lg:table-cell">Phone</th>
                    <th className="w-16 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {selectedContacts.map((ct) => (
                    <tr key={ct.id} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-1.5 font-medium">
                          {ct.name}
                          {ct.primary && <Star className="h-3 w-3 fill-amber-400 text-amber-400" />}
                        </span>
                      </td>
                      <td className="hidden px-4 py-2.5 text-muted-foreground sm:table-cell">{ct.title}</td>
                      <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">{ct.email}</td>
                      <td className="hidden px-4 py-2.5 text-muted-foreground lg:table-cell">{ct.phone}</td>
                      <td className="px-2 py-2.5">
                        <div className="flex justify-end gap-0.5">
                          <button
                            onClick={() => {
                              setEditingContact(ct);
                              setContactForm({ name: ct.name, title: ct.title, email: ct.email, phone: ct.phone, primary: ct.primary });
                              setContactDialogOpen(true);
                            }}
                            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                            title="Edit contact"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => { deleteContact(ct.id); log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'user', kind: 'system', message: `Contact ${ct.name} removed.` }); }}
                            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            title="Remove contact"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {selectedContacts.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-muted-foreground">No contacts yet for this account.</td></tr>
                  )}
                </tbody>
              </table>
            </Card>

            {/* Related invoices */}
            {accountStats && accountStats.allInvoices.length > 0 && (
              <Card className="p-4">
                <SectionTitle title="Related invoices" sub="Billing history linked to this account" />
                <div className="mt-3 space-y-2">
                  {accountStats.allInvoices.map((i) => (
                    <div key={i.id} className="flex items-center justify-between rounded-xl border p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{i.number}</p>
                        <p className="text-[11px] text-muted-foreground">Issued {i.issued} — due {i.due}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        {!i.customerId && (
                          <Button
                            size="sm" variant="outline" className="h-6 px-2 text-[10px]"
                            title="This match is by client name only — link it as a permanent reference"
                            onClick={() => { updateInvoice(i.id, { customerId: selected.id }); log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'user', kind: 'system', message: `Linked invoice ${i.number} to ${selected.name}.` }); }}
                          >
                            Link
                          </Button>
                        )}
                        <span className={cn('rounded-full px-1.5 py-0.5 text-[9px] font-medium capitalize ring-1', INVOICE_STATUS_STYLE[i.status])}>{i.status}</span>
                        <p className="font-mono text-xs">{money(i.amount)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Related projects */}
            {relatedProjects.length > 0 && (
              <Card className="p-4">
                <SectionTitle title="Related projects" sub="Delivery work scoped to this account" />
                <div className="mt-3 space-y-2">
                  {relatedProjects.map((p) => {
                    const spend = computeProjectActualSpend(finance, p.id);
                    return (
                      <button
                        key={p.id}
                        onClick={() => openProject(p.id)}
                        className="flex w-full items-center justify-between rounded-xl border p-3 text-left hover:bg-muted/30"
                      >
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                            <FolderKanban className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> {p.name}
                          </p>
                          <p className="text-[11px] text-muted-foreground">{money(spend)} / {money(p.budgetAmount)} spent</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className={cn('rounded-full px-1.5 py-0.5 text-[9px] font-medium capitalize ring-1', PROJECT_STATUS_STYLE[p.status])}>{PROJECT_STATUS_LABEL[p.status]}</span>
                          <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* Account tasks */}
            <Card className="p-4">
              <SectionTitle title="Tasks" sub={`Work items tied directly to ${selected.name}`} />
              <div className="mt-3 flex gap-2">
                <Input
                  value={taskDraft}
                  onChange={(e) => setTaskDraft(e.target.value)}
                  placeholder="Add a task for this account…"
                  onKeyDown={(e) => e.key === 'Enter' && addAccountTask()}
                />
                <Button size="icon" onClick={addAccountTask}><Plus className="h-4 w-4" /></Button>
              </div>
              <div className="mt-3 space-y-1.5">
                {relatedTasks.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">No tasks linked yet.</p>}
                {relatedTasks.map((t) => (
                  <div key={t.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                    <span className={cn('flex items-center gap-1.5', t.status === 'done' && 'text-muted-foreground line-through')}>
                      <CheckSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> {t.title}
                    </span>
                    <Badge variant="outline" className="shrink-0 text-[10px] capitalize">{t.status.replace('-', ' ')}</Badge>
                  </div>
                ))}
              </div>
            </Card>

            {/* Related deals */}
            {accountStats && accountStats.relatedDeals.length > 0 && (
              <Card className="p-4">
                <SectionTitle title="Related deals" sub="Pipeline entries linked to this account" />
                <div className="mt-3 space-y-2">
                  {accountStats.relatedDeals.map((d) => (
                    <div key={d.id} className="flex items-center justify-between rounded-xl border p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{d.name}</p>
                        <p className="text-[11px] text-muted-foreground capitalize">{d.stage} — source {d.source}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        {!d.customerId && (
                          <Button
                            size="sm" variant="outline" className="h-6 px-2 text-[10px]"
                            title="This match is by company name only — link it as a permanent reference"
                            onClick={() => { updateLead(d.id, { customerId: selected.id }); log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'user', kind: 'system', message: `Linked deal "${d.name}" to ${selected.name}.` }); }}
                          >
                            Link
                          </Button>
                        )}
                        <p className="font-mono text-xs">{money(d.value)}</p>
                        <Progress value={d.priority === 'P0' ? 100 : d.priority === 'P1' ? 66 : 33} className="h-1.5 w-14" />
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        ) : (
          <Card className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">
            <Building2 className="mr-2 h-5 w-5 opacity-40" />
            Select or create a customer account.
          </Card>
        )}
      </div>

      {/* Customer create / edit */}
      <Dialog open={custDialogOpen} onOpenChange={(o) => { setCustDialogOpen(o); if (!o) setEditingCustomer(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingCustomer ? `Edit ${editingCustomer.name}` : 'New customer account'}</DialogTitle>
            <DialogDescription>Accounts group deals, invoices and contacts under one company record.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Company name *">
                <Input value={custForm.name} onChange={(e) => setCustForm({ ...custForm, name: e.target.value })} placeholder="Acme Industries" />
              </Field>
              <Field label="Industry">
                <IndustryInput value={custForm.industry} onChange={(v) => setCustForm({ ...custForm, industry: v })} />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Website">
                <Input value={custForm.website} onChange={(e) => setCustForm({ ...custForm, website: e.target.value })} placeholder="acme.com" />
              </Field>
              <Field label="Email">
                <Input type="email" value={custForm.email} onChange={(e) => setCustForm({ ...custForm, email: e.target.value })} placeholder="hello@acme.com" />
              </Field>
              <Field label="Phone">
                <Input value={custForm.phone} onChange={(e) => setCustForm({ ...custForm, phone: e.target.value })} placeholder="+1 555 0100" />
              </Field>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <Field label="Address" className="col-span-4 sm:col-span-2">
                <Input value={custForm.addressLine} onChange={(e) => setCustForm({ ...custForm, addressLine: e.target.value })} placeholder="100 Main St" />
              </Field>
              <Field label="Country">
                <CountrySelect value={custForm.country} onChange={(v) => setCustForm({ ...custForm, country: v, state: '', city: '' })} />
              </Field>
              <Field label="State / Province">
                <RegionSelect country={custForm.country} value={custForm.state} onChange={(v) => setCustForm({ ...custForm, state: v })} />
              </Field>
              <Field label="City" className="col-span-4 sm:col-span-2">
                <CityInput country={custForm.country} state={custForm.state} value={custForm.city} onChange={(v) => setCustForm({ ...custForm, city: v })} />
              </Field>
              <Field label="Status">
                <Select value={custForm.status} onValueChange={(v) => setCustForm({ ...custForm, status: v as CustomerStatus })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prospect">Prospect</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="churned">Churned</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Account owner" className="col-span-2">
                <Input list="customer-agents" value={custForm.owner} onChange={(e) => setCustForm({ ...custForm, owner: e.target.value })} placeholder="Aisha Bello" />
                <datalist id="customer-agents">
                  {agents.map((a) => (
                    <option key={a.id} value={a.name} />
                  ))}
                </datalist>
              </Field>
            </div>
            <Field label="Notes">
              <Textarea rows={3} value={custForm.notes} onChange={(e) => setCustForm({ ...custForm, notes: e.target.value })} placeholder="Context, renewal dates, escalation paths…" />
            </Field>
          </div>
          <DialogFooter>
            <Button onClick={submitCustomer} disabled={!custForm.name.trim()}>
              {editingCustomer ? 'Save changes' : 'Create account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Contact create / edit */}
      <Dialog open={contactDialogOpen} onOpenChange={(o) => { setContactDialogOpen(o); if (!o) setEditingContact(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingContact ? `Edit ${editingContact.name}` : `Add contact at ${selected?.name ?? ''}`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name *">
                <Input value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} placeholder="Jane Cooper" />
              </Field>
              <Field label="Title">
                <Input value={contactForm.title} onChange={(e) => setContactForm({ ...contactForm, title: e.target.value })} placeholder="Procurement Lead" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Email">
                <Input type="email" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} placeholder="jane@acme.com" />
              </Field>
              <Field label="Phone">
                <Input value={contactForm.phone} onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })} placeholder="+1 555 0111" />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={contactForm.primary}
                onChange={(e) => setContactForm({ ...contactForm, primary: e.target.checked })}
                className="accent-[var(--primary)]"
              />
              Primary contact for the account
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setContactDialogOpen(false); setEditingContact(null); }}><X className="mr-1 h-3 w-3" /> Cancel</Button>
            <Button onClick={submitContact} disabled={!contactForm.name.trim()}>{editingContact ? 'Save changes' : 'Add contact'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {confirmDelete?.name}?</DialogTitle>
            <DialogDescription>
              The account and its {confirmDelete ? contacts.filter((ct) => ct.customerId === confirmDelete.id).length : 0} contact(s) are removed. Deals and invoices keep their historical records.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { if (confirmDelete) { deleteCustomer(confirmDelete.id); log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'user', kind: 'system', message: `Customer account "${confirmDelete.name}" deleted.` }); } setConfirmDelete(null); }}>
              Delete account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
