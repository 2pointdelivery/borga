'use client';

import { useEffect, useState } from 'react';
import { Send, Mail, MessageSquare, MessageCircle, Users, X, Search, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';
import { COMMS_CHANNEL_COLOR, COMMS_CHANNEL_LABEL, type CommsChannel, type Lead } from '@/lib/borga/data';
import { cn } from '@/lib/utils';
import { sendCompanyEmail } from '@/lib/borga/send-mail-client';

const CHANNEL_ICON: Record<CommsChannel, typeof Mail> = { email: Mail, sms: MessageSquare, whatsapp: MessageCircle, telegram: Send };

/** Real contact info, or '' when the lead cannot receive this channel — never fabricated. */
function contactFor(l: Lead, channel: CommsChannel): string {
  if (channel === 'email') return l.email.trim();
  if (channel === 'sms' || channel === 'whatsapp') return l.phone.trim();
  return '';
}

export function CommsDialog({
  open,
  onOpenChange,
  mode,
  lead,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: 'single' | 'bulk';
  lead?: Lead | null;
}) {
  const { leads, sendMessage, log, composio, activeWorkspaceId } = useBorga();
  const [channel, setChannel] = useState<CommsChannel>('email');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [chipQuery, setChipQuery] = useState('');
  const [sending, setSending] = useState(false);

  const openLeads = leads.filter((l) => l.stage !== 'lost');
  const chosenLeads = mode === 'bulk' ? openLeads.filter((l) => selectedIds.includes(l.id)) : lead ? [lead] : [];
  // Only leads with a real contact for this channel can be reached.
  const reachable = chosenLeads.filter((l) => contactFor(l, channel) !== '');
  const unreachable = chosenLeads.filter((l) => contactFor(l, channel) === '');
  const recipients = reachable.map((l) => contactFor(l, channel));
  const targetLabel = mode === 'bulk' ? `${reachable.length} open leads` : lead ? lead.name : '';

  useEffect(() => {
    if (open && mode === 'bulk') setSelectedIds(openLeads.map((l) => l.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  const reset = () => {
    setChannel('email');
    setSubject('');
    setBody('');
    setSelectedIds([]);
    setChipQuery('');
    setSending(false);
  };

  /** One real delivery attempt — the same paths the Inbox composer uses. */
  const deliver = async (to: string): Promise<{ ok: boolean; note?: string }> => {
    if (channel === 'email') {
      const r = await sendCompanyEmail({ ws: activeWorkspaceId, to, subject, body, composioKey: composio.apiKey });
      return r.ok ? { ok: true } : { ok: false, note: r.note ?? 'The email could not be sent.' };
    }
    if (channel === 'whatsapp') {
      try {
        const res = await fetch('/api/borga/whatsapp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
          body: JSON.stringify({ action: 'send', to, text: body.trim(), ws: activeWorkspaceId }),
        });
        const d = (await res.json()) as { ok?: boolean; error?: string };
        return d.ok ? { ok: true } : { ok: false, note: d.error ?? 'WhatsApp is not configured — add a WhatsApp access token in Integrations.' };
      } catch {
        return { ok: false, note: 'Network error reaching the send service.' };
      }
    }
    // sms / telegram have no connected provider — never pretend otherwise.
    return { ok: false, note: `${COMMS_CHANNEL_LABEL[channel]} has no connected provider yet — save the message as a draft instead.` };
  };

  /** "Save as draft": kept for later, never labelled sent. The dashboard has no message scheduler, so nothing here is called "scheduled". */
  const saveDraft = () => {
    if (!body.trim() || reachable.length === 0) return;
    const target = mode === 'single' && lead ? `${lead.name} <draft>` : targetLabel;
    sendMessage({
      id: `m-${Date.now()}`,
      channel,
      to: target,
      recipients,
      subject: channel === 'email' ? subject.trim() : '',
      body: body.trim(),
      status: 'draft',
      mode,
      count: recipients.length,
      sentAt: 'Draft',
    });
    log({
      agentId: 'a-sales',
      agentName: 'Atlas',
      actor: 'user',
      kind: 'task',
      message: `Draft ${COMMS_CHANNEL_LABEL[channel].toLowerCase()} saved for ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}${lead ? ` (${lead.name})` : ''}.`,
    });
    reset();
    onOpenChange(false);
  };

  const send = async () => {
    if (!body.trim() || reachable.length === 0 || sending) return;
    setSending(true);
    let sent = 0;
    let failed = 0;
    try {
      for (const l of reachable) {
        const to = contactFor(l, channel);
        const result = await deliver(to);
        sendMessage({
          id: `m-${Date.now()}-${l.id}`,
          channel,
          to: `${l.name} <${to}>`,
          recipients: [to],
          subject: channel === 'email' ? subject.trim() : '',
          body: body.trim(),
          status: result.ok ? 'sent' : 'failed',
          mode: 'single',
          count: 1,
          sentAt: result.ok ? 'Just now' : (result.note ?? 'Failed'),
        });
        if (result.ok) sent++;
        else failed++;
      }
      log({
        agentId: 'a-sales',
        agentName: 'Atlas',
        actor: 'user',
        kind: failed ? 'system' : 'task',
        message: `${COMMS_CHANNEL_LABEL[channel]} send finished: ${sent} delivered, ${failed} failed${unreachable.length ? `, ${unreachable.length} skipped (no ${channel === 'email' ? 'email address' : 'phone number'})` : ''}.`,
      });
      if (failed) toast({ title: `${failed} message${failed !== 1 ? 's' : ''} failed`, description: 'See the inbox for the provider error.', variant: 'error' });
    } finally {
      setSending(false);
    }
    reset();
    onOpenChange(false);
  };

  const toggleLead = (id: string) =>
    setSelectedIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const Icon = CHANNEL_ICON[channel];

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === 'bulk' ? 'Bulk message' : 'Send message'}</DialogTitle>
          <DialogDescription>
            {mode === 'bulk'
              ? `Reach ${openLeads.length} open leads — choose who receives this message.`
              : lead
                ? `Compose a message for ${lead.name}${lead.email ? ` (${lead.email})` : ''}.`
                : 'Compose a message for this lead.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {(['email', 'sms', 'whatsapp'] as CommsChannel[]).map((c) => {
              const C = CHANNEL_ICON[c];
              return (
                <button
                  key={c}
                  onClick={() => setChannel(c)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-medium transition-colors',
                    channel === c ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:border-muted-foreground/40',
                  )}
                >
                  <C className="h-3.5 w-3.5" /> {COMMS_CHANNEL_LABEL[c]}
                </button>
              );
            })}
          </div>

          {channel === 'email' && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Subject</label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Proposal follow-up" className="mt-1" />
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-muted-foreground">Message</label>
            <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder={channel === 'email' ? 'Write your email…' : 'Write your message…'} className="mt-1" />
          </div>

          {/* Recipients */}
          <div className="rounded-lg border bg-muted/20 px-3 py-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground/80">Recipients ({recipients.length}{unreachable.length ? ` + ${unreachable.length} skipped` : ''})</span>
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Users className="h-3.5 w-3.5" /> via {COMMS_CHANNEL_LABEL[channel]}
              </span>
            </div>
            {unreachable.length > 0 && (
              <p className="mt-1 text-[11px] text-amber-600">
                {unreachable.length} lead{unreachable.length !== 1 ? 's' : ''} skipped — no {channel === 'email' ? 'email address' : 'phone number'} on file: {unreachable.slice(0, 3).map((l) => l.name).join(', ')}{unreachable.length > 3 ? '…' : ''}
              </p>
            )}
            {mode === 'bulk' ? (
              <>
                <div className="relative mt-2">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input value={chipQuery} onChange={(e) => setChipQuery(e.target.value)} placeholder="Filter leads…" className="h-7 pl-8 text-xs" />
                </div>
                <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                  {openLeads
                    .filter((l) => !chipQuery.trim() || `${l.name} ${l.company} ${l.email}`.toLowerCase().includes(chipQuery.trim().toLowerCase()))
                    .map((l) => {
                      const on = selectedIds.includes(l.id);
                      const ok = contactFor(l, channel) !== '';
                      return (
                        <button
                          key={l.id}
                          onClick={() => toggleLead(l.id)}
                          className={cn(
                            'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                            on ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:border-muted-foreground/40',
                          )}
                          title={ok ? `${l.name} — ${contactFor(l, channel)}` : `${l.name} — no ${channel === 'email' ? 'email' : 'phone'} on file`}
                        >
                          {on && <X className="h-3 w-3" />}
                          {l.name}{!ok && ' ⚠'}
                        </button>
                      );
                    })}
                  {openLeads.length === 0 && <span className="text-[11px] text-muted-foreground">No open leads to message.</span>}
                </div>
              </>
            ) : lead ? (
              <div className="mt-2 flex items-center gap-1.5">
                <Badge className={cn('gap-1 ring-1', COMMS_CHANNEL_COLOR[channel])}><Icon className="h-3 w-3" />{COMMS_CHANNEL_LABEL[channel]}</Badge>
                <span className="text-xs">{lead.name} — {lead.company} — <span className="font-mono text-[10px]">{recipients[0] || `no ${channel === 'email' ? 'email' : 'phone'} on file`}</span></span>
              </div>
            ) : null}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 gap-1.5" onClick={saveDraft} disabled={!body.trim() || reachable.length === 0 || sending} title="Keep the message as a draft — nothing is sent">
              <Save className="h-4 w-4" /> Save draft
            </Button>
            <Button className="flex-1 gap-1.5" onClick={() => void send()} disabled={!body.trim() || reachable.length === 0 || sending}>
              <Send className="h-4 w-4" /> {sending ? 'Sending…' : 'Send now'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
