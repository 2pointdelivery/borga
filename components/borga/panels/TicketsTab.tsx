'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, LayoutList, Columns3, Loader2, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';
import { ticketsApi, type ClientSettings } from '@/lib/borga/tickets-client';
import {
  STATUS_LABEL,
  TICKET_PRIORITIES,
  TICKET_TYPES,
  isDoneStatus,
  type TicketPriority,
  type TicketStatus,
  type TicketSummary,
  type TicketType,
} from '@/lib/borga/tickets';
import { cn } from '@/lib/utils';
import { SectionTitle } from '../bits';
import { Field } from '../form-widgets';
import { TicketDetailSheet } from '../TicketDetailSheet';
import { SearchSelect } from '../SearchSelect';
import { PriorityPill, SlaBadge, StatusPill, slaFor } from '../ticket-bits';

const ALL = '__all__';
const NONE = '__none__';
const UNASSIGNED = '__unassigned__';
const BOARD_COLUMNS: TicketStatus[] = ['open', 'in-progress', 'pending', 'resolved', 'closed'];
const POLL_MS = 20_000;
const PRIORITY_RANK: Record<TicketPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const EMPTY_FORM = { subject: '', description: '', requesterName: '', requesterEmail: '', type: 'request' as TicketType, priority: 'medium' as TicketPriority, assignee: NONE, projectId: NONE };

export function TicketsTab() {
  const { activeWorkspaceId: ws, employees, projects, userName } = useBorga();
  const actor = userName?.trim() ? userName.trim() : 'Agent';
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [settings, setSettings] = useState<ClientSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [view, setView] = useState<'list' | 'board'>('list');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [priorityFilter, setPriorityFilter] = useState(ALL);
  const [assigneeFilter, setAssigneeFilter] = useState(ALL);
  const [openId, setOpenId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await ticketsApi.list(ws);
    if (r.ok) {
      setTickets(r.tickets);
      setSettings(r.settings);
      setError(null);
    } else {
      setError(r.error ?? 'Could not load tickets');
    }
    setLoading(false);
    setNowMs(Date.now());
  }, [ws]);

  useEffect(() => {
    setLoading(true);
    void refresh();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const assignees = useMemo(() => [...new Set(tickets.map((t) => t.assignee).filter(Boolean))].sort(), [tickets]);

  const rows = useMemo(() => {
    if (!settings) return [];
    const needle = q.trim().toLowerCase();
    return tickets
      .filter((t) => {
        if (statusFilter === 'active' ? isDoneStatus(t.status) : statusFilter !== ALL && t.status !== statusFilter) return false;
        if (priorityFilter !== ALL && t.priority !== priorityFilter) return false;
        if (assigneeFilter === UNASSIGNED ? !!t.assignee : assigneeFilter !== ALL && t.assignee !== assigneeFilter) return false;
        return !needle || `${t.id} ${t.subject} ${t.requesterName} ${t.requesterEmail} ${t.labels.join(' ')}`.toLowerCase().includes(needle);
      })
      .sort((a, b) => {
        const done = Number(isDoneStatus(a.status)) - Number(isDoneStatus(b.status));
        return done || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.updatedAt.localeCompare(a.updatedAt);
      });
  }, [tickets, settings, q, statusFilter, priorityFilter, assigneeFilter]);

  const stats = useMemo(() => {
    if (!settings) return null;
    const active = tickets.filter((t) => !isDoneStatus(t.status));
    const states = active.map((t) => slaFor(t, settings, nowMs).worst);
    const finished = tickets.filter((t) => isDoneStatus(t.status));
    const met = finished.filter((t) => ['met', 'running'].includes(slaFor(t, settings, nowMs).worst)).length;
    return {
      open: active.length,
      breached: states.filter((s) => s === 'breached').length,
      atRisk: states.filter((s) => s === 'at-risk').length,
      unassigned: active.filter((t) => !t.assignee).length,
      compliance: finished.length ? Math.round((met / finished.length) * 100) : null,
    };
  }, [tickets, settings, nowMs]);

  const create = async () => {
    if (!form.subject.trim()) return;
    setCreating(true);
    const r = await ticketsApi.create(
      ws,
      {
        subject: form.subject,
        description: form.description,
        requesterName: form.requesterName,
        requesterEmail: form.requesterEmail,
        type: form.type,
        priority: form.priority,
        assignee: form.assignee === NONE ? '' : form.assignee,
        projectId: form.projectId === NONE ? undefined : form.projectId,
      },
      actor,
    );
    setCreating(false);
    if (!r.ok) return toast({ title: 'Could not create ticket', description: r.issues?.join('; ') ?? r.error, variant: 'error' });
    setCreateOpen(false);
    setForm(EMPTY_FORM);
    await refresh();
    setOpenId(r.ticket.id);
  };

  const moveTo = async (id: string, status: TicketStatus) => {
    const t = tickets.find((x) => x.id === id);
    if (!t || t.status === status) return;
    const r = await ticketsApi.update(ws, id, { status }, 'Agent');
    if (!r.ok) toast({ title: 'Move not allowed', description: r.error, variant: 'warning' });
    await refresh();
  };

  if (loading && !settings) {
    return <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }
  if (!settings) {
    return (
      <Card className="p-6 text-sm">
        <p className="font-medium">Support Desk is unavailable</p>
        <p className="mt-1 text-muted-foreground">{error ?? 'Unknown error'}. If the feature was switched off, re-enable it in Settings → Features.</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={refresh}>Retry</Button>
      </Card>
    );
  }

  const mailboxOn = settings.mailbox.enabled;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle title="Support Desk" sub={mailboxOn ? `Linked mailbox: ${settings.mailbox.address || 'configured'} — email in, email out, one thread per ticket` : 'Tickets with SLA timers. Link a mailbox under SLA & Mailbox to work tickets by email.'} />
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={refresh} title="Refresh"><RefreshCw className="h-4 w-4" /></Button>
          <Button onClick={() => setCreateOpen(true)} className="gap-1.5"><Plus className="h-4 w-4" /> New ticket</Button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            ['Active', stats.open, ''],
            ['SLA breached', stats.breached, stats.breached ? 'text-rose-600' : ''],
            ['At risk', stats.atRisk, stats.atRisk ? 'text-amber-600' : ''],
            ['Unassigned', stats.unassigned, ''],
            ['SLA compliance', stats.compliance === null ? '—' : `${stats.compliance}%`, ''],
          ].map(([label, value, cls]) => (
            <Card key={label as string} className="p-3">
              <p className="text-[11px] text-muted-foreground">{label}</p>
              <p className={cn('text-xl font-semibold', cls as string)}>{value}</p>
            </Card>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search key, subject, requester, label" className="pl-8" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value="active">Active only</SelectItem>
            {(['open', 'in-progress', 'pending', 'resolved', 'closed'] as TicketStatus[]).map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All priorities</SelectItem>
            {TICKET_PRIORITIES.map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <SearchSelect
          options={[
            { value: ALL, label: 'Anyone' },
            { value: UNASSIGNED, label: 'Unassigned' },
            ...assignees.map((a) => ({ value: a, label: a })),
          ]}
          value={assigneeFilter}
          onChange={setAssigneeFilter}
          placeholder="Anyone"
          searchPlaceholder="Search assignees"
          clearable={false}
          className="w-40"
        />
        <div className="flex rounded-md border">
          <Button variant={view === 'list' ? 'secondary' : 'ghost'} size="icon" onClick={() => setView('list')} title="List"><LayoutList className="h-4 w-4" /></Button>
          <Button variant={view === 'board' ? 'secondary' : 'ghost'} size="icon" onClick={() => setView('board')} title="Board"><Columns3 className="h-4 w-4" /></Button>
        </div>
      </div>

      {error && <p className="text-xs text-amber-600">Showing last loaded data — {error}</p>}

      {view === 'list' ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  {['Key', 'Subject', 'Status', 'Priority', 'SLA', 'Assignee', 'Updated'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} onClick={() => setOpenId(t.id)} className="cursor-pointer border-b last:border-0 hover:bg-muted/30">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{t.id}</td>
                    <td className="max-w-80 px-3 py-2">
                      <p className="truncate font-medium">{t.subject}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{t.requesterName}{t.source === 'email' ? ' · via email' : ''}</p>
                    </td>
                    <td className="px-3 py-2"><StatusPill s={t.status} /></td>
                    <td className="px-3 py-2"><PriorityPill p={t.priority} /></td>
                    <td className="px-3 py-2"><SlaBadge t={t} settings={settings} nowMs={nowMs} /></td>
                    <td className="px-3 py-2 text-xs">{t.assignee || <span className="text-muted-foreground">Unassigned</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{new Date(t.lastActivityAt).toLocaleString()}</td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    {tickets.length ? 'No tickets match these filters.' : 'No tickets yet. Create one, or link a mailbox so customer emails open tickets automatically.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
          {BOARD_COLUMNS.map((col) => {
            const items = rows.filter((t) => t.status === col);
            return (
              <div
                key={col}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragId) void moveTo(dragId, col);
                  setDragId(null);
                }}
                className="min-h-40 rounded-lg border bg-muted/20 p-2"
              >
                <p className="mb-2 flex items-center justify-between px-1 text-xs font-medium">{STATUS_LABEL[col]}<span className="text-muted-foreground">{items.length}</span></p>
                <div className="space-y-2">
                  {items.map((t) => (
                    <Card key={t.id} draggable onDragStart={() => setDragId(t.id)} onClick={() => setOpenId(t.id)} className="cursor-pointer space-y-1.5 p-2.5 hover:border-primary/40">
                      <div className="flex items-center justify-between"><span className="font-mono text-[11px] text-muted-foreground">{t.id}</span><PriorityPill p={t.priority} /></div>
                      <p className="line-clamp-2 text-sm font-medium">{t.subject}</p>
                      <SlaBadge t={t} settings={settings} nowMs={nowMs} />
                      <p className="text-[11px] text-muted-foreground">{t.assignee || 'Unassigned'}</p>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TicketDetailSheet ws={ws} ticketId={openId} settings={settings} nowMs={nowMs} onClose={() => setOpenId(null)} onChanged={refresh} />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New ticket</DialogTitle>
            <DialogDescription>Open a ticket manually — mailbox emails create them automatically.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Field label="Subject"><Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} maxLength={200} autoFocus /></Field>
            <Field label="Description"><Textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Requester name"><Input value={form.requesterName} onChange={(e) => setForm({ ...form, requesterName: e.target.value })} /></Field>
              <Field
                label="Requester email"
                hint={settings?.mailbox?.enabled ? 'Mailbox is on — replies go to this address' : 'Replies are emailed here'}
              >
                <Input type="email" value={form.requesterEmail} onChange={(e) => setForm({ ...form, requesterEmail: e.target.value })} />
              </Field>
              <Field label="Type">
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as TicketType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TICKET_TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Priority">
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v as TicketPriority })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TICKET_PRIORITIES.map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Assignee">
                <SearchSelect
                  options={[
                    { value: NONE, label: 'Unassigned' },
                    ...employees.map((e) => ({ value: e.name, label: e.name })),
                  ]}
                  value={form.assignee}
                  onChange={(v) => setForm({ ...form, assignee: v || NONE })}
                  placeholder="Unassigned"
                  searchPlaceholder="Search team"
                  clearable={false}
                />
              </Field>
              <Field label="Project">
                <SearchSelect
                  options={[
                    { value: NONE, label: 'No project' },
                    ...projects.map((p) => ({ value: p.id, label: p.name, detail: p.status })),
                  ]}
                  value={form.projectId}
                  onChange={(v) => setForm({ ...form, projectId: v || NONE })}
                  placeholder="No project"
                  searchPlaceholder="Search projects"
                  clearable={false}
                />
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={create} disabled={creating || !form.subject.trim()}>{creating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Create ticket</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
