'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Send, Lock, Mail, Bot, AlertTriangle } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';
import { ticketsApi, type ClientSettings } from '@/lib/borga/tickets-client';
import {
  STATUS_LABEL,
  TICKET_PRIORITIES,
  TICKET_TYPES,
  TRANSITIONS,
  fmtDuration,
  type Ticket,
  type TicketComment,
  type TicketStatus,
} from '@/lib/borga/tickets';
import { cn } from '@/lib/utils';
import { Field } from './form-widgets';
import { PriorityPill, SlaPanel, StatusPill } from './ticket-bits';

const NONE = '__none__';
const ACTOR = 'Agent';

function CommentView({ c }: { c: TicketComment }) {
  if (c.kind === 'system') {
    return <p className="text-center text-[11px] text-muted-foreground">{c.body} · {new Date(c.at).toLocaleString()}</p>;
  }
  const internal = c.kind === 'internal';
  const inbound = c.kind === 'email-in';
  return (
    <div className={cn('rounded-lg border p-3 text-sm', internal && 'border-amber-500/30 bg-amber-500/5', inbound && 'bg-muted/40')}>
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        {internal ? <Lock className="h-3 w-3" /> : inbound ? <Mail className="h-3 w-3" /> : <Send className="h-3 w-3" />}
        <span className="font-medium text-foreground">{c.author}</span>
        <span>{internal ? 'internal note' : inbound ? 'emailed in' : 'replied to customer'}</span>
        <span className="ml-auto">{new Date(c.at).toLocaleString()}</span>
      </div>
      <p className="whitespace-pre-wrap break-words">{c.body}</p>
      {c.kind === 'public' && c.delivery && c.delivery !== 'sent' && (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-amber-600">
          <AlertTriangle className="h-3 w-3" />
          {c.delivery === 'not-configured' ? 'Saved, but not emailed — SMTP is not configured.' : 'Saved, but the email failed to send.'}
        </p>
      )}
    </div>
  );
}

export function TicketDetailSheet({
  ws,
  ticketId,
  settings,
  nowMs,
  onClose,
  onChanged,
}: {
  ws: string;
  ticketId: string | null;
  settings: ClientSettings;
  nowMs: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { employees, projects } = useBorga();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(false);
  const [body, setBody] = useState('');
  const [mode, setMode] = useState<'public' | 'internal'>('public');
  const [after, setAfter] = useState<string>(NONE);
  const [busy, setBusy] = useState(false);
  const [similar, setSimilar] = useState<Array<{ ticketId: string; title: string; excerpt: string }> | null>(null);

  const load = useCallback(async () => {
    if (!ticketId) return;
    const r = await ticketsApi.get(ws, ticketId);
    if (r.ok) setTicket(r.ticket);
    else toast({ title: 'Could not load ticket', description: r.error, variant: 'error' });
    setLoading(false);
  }, [ws, ticketId]);

  useEffect(() => {
    setTicket(null);
    setSimilar(null);
    setBody('');
    setAfter(NONE);
    if (ticketId) {
      setLoading(true);
      void load();
    }
  }, [ticketId, load]);

  // Resolved tickets that resemble this one (only when Supermemory + ticket indexing are on).
  useEffect(() => {
    if (!ticketId || !ticket || ticket.id !== ticketId) return;
    let live = true;
    void ticketsApi.similar(ws, ticketId).then((r) => {
      if (live && r.ok && r.enabled) setSimilar(r.similar);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId, ticket?.id]);

  const patch = async (p: Record<string, unknown>) => {
    if (!ticket) return;
    const r = await ticketsApi.update(ws, ticket.id, p, ACTOR);
    if (!r.ok) return toast({ title: 'Update failed', description: r.error, variant: 'error' });
    setTicket(r.ticket);
    onChanged();
  };

  const send = async () => {
    if (!ticket || !body.trim()) return;
    setBusy(true);
    const r = await ticketsApi.comment(ws, ticket.id, mode, body, ACTOR, after === NONE ? undefined : after);
    setBusy(false);
    if (!r.ok) return toast({ title: 'Could not post', description: r.error, variant: 'error' });
    setTicket(r.ticket);
    setBody('');
    setAfter(NONE);
    onChanged();
    const last = r.ticket.comments[r.ticket.comments.length - 1];
    if (mode === 'public' && last?.delivery && last.delivery !== 'sent') {
      toast({ title: 'Reply saved, not emailed', description: last.delivery === 'not-configured' ? 'Configure SMTP to deliver replies.' : 'The mail server rejected the message.', variant: 'warning' });
    }
  };

  const statusOptions: TicketStatus[] = ticket ? [ticket.status, ...TRANSITIONS[ticket.status]] : [];

  return (
    <Sheet open={!!ticketId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 pr-6">
            <span className="font-mono text-sm text-muted-foreground">{ticketId}</span>
            <span className="truncate">{ticket?.subject ?? '…'}</span>
          </SheetTitle>
          <SheetDescription>
            {ticket ? `${ticket.requesterName} <${ticket.requesterEmail || 'no email'}> · via ${ticket.source} · opened ${new Date(ticket.createdAt).toLocaleString()}` : 'Loading…'}
          </SheetDescription>
        </SheetHeader>

        {loading || !ticket ? (
          <div className="flex justify-center p-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
        ) : (
          <div className="grid gap-5 p-4 md:grid-cols-[1fr_250px]">
            <div className="space-y-3">
              {ticket.description && (
                <div className="rounded-lg border p-3 text-sm">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Description</p>
                  <p className="whitespace-pre-wrap break-words">{ticket.description}</p>
                </div>
              )}
              <div className="space-y-2">
                {ticket.comments.map((c) => <CommentView key={c.id} c={c} />)}
              </div>

              {similar && similar.length > 0 && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs">
                  <p className="mb-1.5 font-medium">Similar resolved tickets</p>
                  <ul className="space-y-2">
                    {similar.map((s) => (
                      <li key={s.ticketId}><span className="font-mono text-muted-foreground">{s.ticketId}</span> {s.title}<p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-muted-foreground">{s.excerpt}</p></li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="rounded-lg border p-3">
                <div className="mb-2 flex gap-1">
                  <Button size="sm" variant={mode === 'public' ? 'default' : 'outline'} onClick={() => setMode('public')} className="gap-1.5">
                    <Send className="h-3.5 w-3.5" /> Reply to customer
                  </Button>
                  <Button size="sm" variant={mode === 'internal' ? 'default' : 'outline'} onClick={() => setMode('internal')} className="gap-1.5">
                    <Lock className="h-3.5 w-3.5" /> Internal note
                  </Button>
                </div>
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={4}
                  placeholder={mode === 'public' ? (ticket.requesterEmail ? `Emails ${ticket.requesterEmail} — keeps the thread` : 'This ticket has no requester email; the reply is saved only') : 'Visible to your team only'}
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <Select value={after} onValueChange={setAfter}>
                    <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Keep status</SelectItem>
                      {TRANSITIONS[ticket.status].map((s) => <SelectItem key={s} value={s}>Then set {STATUS_LABEL[s]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button size="sm" onClick={send} disabled={busy || !body.trim()} className="gap-1.5">
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {mode === 'public' ? 'Send reply' : 'Add note'}
                  </Button>
                </div>
              </div>
            </div>

            <aside className="space-y-4">
              <div className="flex gap-1.5"><StatusPill s={ticket.status} /><PriorityPill p={ticket.priority} /></div>
              <Field label="Status">
                <Select value={ticket.status} onValueChange={(v) => patch({ status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{statusOptions.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Priority">
                <Select value={ticket.priority} onValueChange={(v) => patch({ priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TICKET_PRIORITIES.map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Type">
                <Select value={ticket.type} onValueChange={(v) => patch({ type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TICKET_TYPES.map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Assignee">
                <Select value={ticket.assignee || NONE} onValueChange={(v) => patch({ assignee: v === NONE ? '' : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Unassigned</SelectItem>
                    {ticket.assignee && !employees.some((e) => e.name === ticket.assignee) && <SelectItem value={ticket.assignee}>{ticket.assignee}</SelectItem>}
                    {employees.map((e) => <SelectItem key={e.id} value={e.name}>{e.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Project">
                <Select value={ticket.projectId ?? NONE} onValueChange={(v) => patch({ projectId: v === NONE ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No project</SelectItem>
                    {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="SLA policy">
                <Select value={ticket.slaPolicyId} onValueChange={(v) => patch({ slaPolicyId: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{settings.slaPolicies.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Log time (minutes)" hint={`Total: ${fmtDuration(ticket.timeSpentMin)}`}>
                <Input
                  type="number"
                  min={1}
                  placeholder="e.g. 15, press Enter"
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    const n = Number((e.target as HTMLInputElement).value);
                    if (Number.isInteger(n) && n > 0) {
                      void patch({ addTimeMin: n });
                      (e.target as HTMLInputElement).value = '';
                    }
                  }}
                />
              </Field>
              <div className="border-t pt-3"><SlaPanel t={ticket} settings={settings} nowMs={nowMs} /></div>
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><Bot className="h-3 w-3" /> Reopened {ticket.reopenCount}×</p>
            </aside>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
