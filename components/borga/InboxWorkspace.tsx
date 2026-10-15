'use client';

/**
 * Shared three-pane inbox (Gmail-style) used by the Inbox page (all channels)
 * and the Sales page (compose-centric outbound mode).
 *   Left rail   — folders (All, Scheduled, Drafts, Failed) + channel chips + search
 *   Middle      — thread list, one thread per contact, newest activity first
 *   Right pane  — the thread's timeline (every message, call and chat item)
 *                 plus a channel-aware reply composer
 * Every item on the timeline really happened: delivery goes through the same
 * paths the previous composers used (Gmail via Composio/SMTP, WhatsApp via
 * Meta Cloud API); SMS/Telegram without a provider fail honestly.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Inbox as InboxIcon, Mail, MessageSquare, MessageCircle, Send, Phone, Lock,
  Search, ChevronLeft, RefreshCw, Trash2, Users, CornerUpLeft, FileClock, CircleAlert, CheckCheck,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';
import { COMMS_CHANNEL_LABEL, type CommsChannel, type CommsMessage, type Lead } from '@/lib/borga/data';
import { sendCompanyEmail } from '@/lib/borga/send-mail-client';
import {
  addressOf, buildThreads, itemMatchesFolder, threadMatchesFolder,
  type InboxChannel, type InboxFolder, type InboxItem, type InboxThread,
} from '@/lib/borga/inbox-threads';
import { cn } from '@/lib/utils';
import { useComposioReady } from './use-composio-ready';

const CHANNEL_ICON: Record<InboxChannel, typeof Mail> = {
  email: Mail, sms: MessageSquare, whatsapp: MessageCircle, telegram: Send, call: Phone, secure: Lock,
};

const CHANNEL_STYLE: Record<InboxChannel, string> = {
  email: 'bg-sky-500/10 text-sky-600 ring-sky-500/30',
  sms: 'bg-violet-500/10 text-violet-600 ring-violet-500/30',
  whatsapp: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
  telegram: 'bg-sky-500/10 text-sky-500 ring-sky-500/30',
  call: 'bg-amber-500/10 text-amber-600 ring-amber-500/30',
  secure: 'bg-rose-500/10 text-rose-600 ring-rose-500/30',
};

const FOLDERS: Array<{ id: InboxFolder; label: string; icon: typeof Mail }> = [
  { id: 'all', label: 'All', icon: InboxIcon },
  { id: 'sent', label: 'Sent', icon: CheckCheck },
  { id: 'scheduled', label: 'Scheduled', icon: FileClock },
  { id: 'drafts', label: 'Drafts', icon: CornerUpLeft },
  { id: 'failed', label: 'Failed', icon: CircleAlert },
];

/** Real contact info, or '' when the lead cannot receive this channel — never fabricated. */
function contactFor(l: Lead, channel: CommsChannel): string {
  if (channel === 'email') return l.email.trim();
  if (channel === 'sms' || channel === 'whatsapp') return l.phone.trim();
  return '';
}

function fmtAt(at: string): string {
  if (!at) return '';
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return at; // "Draft", "Just now", provider error text
  const d = new Date(t);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function clockAt(at: string): string {
  const t = Date.parse(at);
  return Number.isFinite(t) ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : at || '—';
}

export function InboxWorkspace({ mode, initialContactKey }: { mode: 'full' | 'sales'; initialContactKey?: string }) {
  const {
    messages, calls, secureChats, sendMessage, deleteMessage, leads, customers, log,
    composio,
  } = useBorga();
  const { ready: composioReady } = useComposioReady();
  const hasComposioKey = !!composio.apiKey || composioReady;

  const [folder, setFolder] = useState<InboxFolder>('all');
  const [channel, setChannel] = useState<'all' | InboxChannel>('all');
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<'list' | 'conv'>('list');
  const [confirmDelete, setConfirmDelete] = useState<InboxItem | null>(null);

  useEffect(() => {
    if (initialContactKey) { setSelectedKey(initialContactKey.toLowerCase()); setMobilePane('conv'); }
  }, [initialContactKey]);

  // ── Everything becomes a timeline item ─────────────────────────────────────
  const items: InboxItem[] = useMemo(() => {
    const out: InboxItem[] = [];
    for (const m of messages) {
      const { name, address } = addressOf(m.to);
      const lead = leads.find((l) => contactFor(l, m.channel) === address || (m.recipients ?? []).includes(l.email) || (m.recipients ?? []).includes(l.phone));
      const cust = customers.find((c) => c.email?.toLowerCase() === address.toLowerCase());
      out.push({
        id: m.id,
        channel: m.channel,
        contactKey: address,
        contactName: lead?.name ?? cust?.name ?? name,
        contactDetail: lead ? `${lead.company}${lead.email ? ` · ${lead.email}` : ''}` : cust?.industry,
        subject: m.subject || undefined,
        body: m.body,
        status: m.status,
        at: Date.parse(m.sentAt) ? new Date(m.sentAt).toISOString() : (m.sentAt || ''),
        mode: m.mode,
        count: m.count,
        linkId: lead?.id,
        note: m.status === 'failed' ? (m.sentAt !== 'Just now' ? m.sentAt : undefined) : undefined,
      });
    }
    for (const c of calls) {
      out.push({
        id: c.id,
        channel: 'call',
        contactKey: c.contact,
        contactName: c.leadName || c.contact,
        contactDetail: c.agentName ? `via ${c.agentName}` : undefined,
        body: c.note || `Call ${c.status} · ${Math.round(c.durationSec / 60)} min ${c.durationSec % 60}s`,
        status: c.status === 'completed' ? 'completed' : c.status === 'active' ? 'active' : 'voicemail',
        at: c.at,
        note: c.mode === 'simulated' ? 'simulated — no Twilio configured' : undefined,
      });
    }
    for (const t of secureChats) {
      for (const sm of t.messages ?? []) {
        out.push({
          id: `${t.id}:${sm.id}`,
          channel: 'secure',
          contactKey: t.participantId,
          contactName: t.participantName,
          contactDetail: 'end-to-end encrypted',
          body: sm.ciphertext ? '🔒 encrypted message — open Encrypted chat to read' : '',
          status: 'sent',
          at: sm.at,
          note: sm.fingerprint ? `fingerprint ${sm.fingerprint.slice(0, 8)}…` : undefined,
        });
      }
    }
    return out;
  }, [messages, calls, secureChats, leads, customers]);

  const threadsAll = useMemo(() => buildThreads(items), [items]);
  const threads = useMemo(
    () => threadsAll
      .filter((t) => threadMatchesFolder(t, folder))
      .filter((t) => channel === 'all' || t.channels.includes(channel))
      .filter((t) => !query.trim() || `${t.contactName} ${t.contactDetail ?? ''} ${t.items.map((i) => `${i.subject ?? ''} ${i.body}`).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase())),
    [threadsAll, folder, channel, query],
  );

  const selected: InboxThread | null = useMemo(
    () => threadsAll.find((t) => t.key === selectedKey) ?? null,
    [threadsAll, selectedKey],
  );
  const selectedItems = useMemo(
    () => (selected ? selected.items.filter((i) => itemMatchesFolder(i, folder) && (channel === 'all' || i.channel === channel)) : []),
    [selected, folder, channel],
  );

  const folderCount = (f: InboxFolder) => threadsAll.filter((t) => threadMatchesFolder(t, f)).length;
  const channelCount = (c: InboxChannel) => threadsAll.filter((t) => t.channels.includes(c)).length;
  const visibleChannels: InboxChannel[] = mode === 'full'
    ? ['email', 'sms', 'whatsapp', 'call', 'secure']
    : ['email', 'sms', 'whatsapp'];

  const pickThread = (key: string) => { setSelectedKey(key); setMobilePane('conv'); };

  return (
    <div className="borga-fade-up grid h-[calc(100vh-11rem)] min-h-[560px] grid-cols-1 gap-0 overflow-hidden rounded-2xl border lg:grid-cols-[200px_minmax(300px,380px)_1fr]">
      {/* ── Left rail: folders + channels ─────────────────────────────────── */}
      <aside className={cn('hidden flex-col border-r bg-muted/30 lg:flex', mobilePane === 'list' && 'lg:flex')}>
        <div className="flex items-center gap-2 border-b px-4 py-3.5">
          <InboxIcon className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">{mode === 'sales' ? 'Sales inbox' : 'Inbox'}</p>
        </div>
        <nav className="space-y-0.5 p-2">
          {FOLDERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFolder(f.id)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors',
                folder === f.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
              )}
            >
              <f.icon className="h-3.5 w-3.5" />
              <span className="flex-1 text-left">{f.label}</span>
              {folderCount(f.id) > 0 && <span className="rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground">{folderCount(f.id)}</span>}
            </button>
          ))}
        </nav>
        <div className="border-t px-4 pb-1 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Channels</p>
        </div>
        <nav className="space-y-0.5 p-2 pt-1">
          <button
            onClick={() => setChannel('all')}
            className={cn('flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-xs transition-colors', channel === 'all' ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/60')}
          >
            All channels <span className="ml-auto text-[10px] text-muted-foreground">{threadsAll.length}</span>
          </button>
          {visibleChannels.map((c) => {
            const Icon = CHANNEL_ICON[c];
            return (
              <button
                key={c}
                onClick={() => setChannel(c)}
                className={cn('flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-xs transition-colors', channel === c ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/60')}
              >
                <span className={cn('flex h-5 w-5 items-center justify-center rounded ring-1', CHANNEL_STYLE[c])}><Icon className="h-3 w-3" /></span>
                {c === 'call' ? 'Calls' : c === 'secure' ? 'Encrypted' : COMMS_CHANNEL_LABEL[c as CommsChannel] ?? c}
                <span className="ml-auto text-[10px] text-muted-foreground">{channelCount(c)}</span>
              </button>
            );
          })}
        </nav>
        {mode === 'sales' && (
          <p className="mt-auto border-t p-3 text-[10px] leading-relaxed text-muted-foreground">
            Threads are your open leads. Compose below to reach one or many; the timeline keeps every touchpoint.
          </p>
        )}
      </aside>

      {/* ── Middle: thread list ───────────────────────────────────────────── */}
      <section className={cn('flex min-w-0 flex-col border-r', mobilePane === 'conv' && 'hidden lg:flex')}>
        <div className="border-b p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={mode === 'sales' ? 'Search leads & messages…' : 'Search inbox…'} className="h-9 pl-8 text-xs" />
          </div>
          <div className="mt-2 flex gap-1 overflow-x-auto lg:hidden">
            {FOLDERS.map((f) => (
              <button key={f.id} onClick={() => setFolder(f.id)} className={cn('shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium', folder === f.id ? 'bg-accent text-accent-foreground' : 'text-muted-foreground')}>{f.label}</button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {threads.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-xs text-muted-foreground">
              <InboxIcon className="h-7 w-7 opacity-40" />
              {items.length === 0 ? (mode === 'sales' ? 'No outreach yet — compose the first message.' : 'Nothing here yet — messages, calls and chats land in this inbox.') : 'No threads match.'}
            </div>
          ) : (
            threads.map((t) => {
              const Icon = CHANNEL_ICON[t.lastItem.channel];
              return (
                <button
                  key={t.key}
                  onClick={() => pickThread(t.key)}
                  className={cn(
                    'flex w-full gap-2.5 border-b px-3 py-2.5 text-left transition-colors last:border-0',
                    selectedKey === t.key ? 'bg-primary/5' : 'hover:bg-muted/40',
                  )}
                >
                  <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ring-1', CHANNEL_STYLE[t.lastItem.channel])}>
                    {t.contactName.slice(0, 2).toUpperCase() || <Icon className="h-3.5 w-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className="truncate text-xs font-semibold">{t.contactName}</p>
                      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{fmtAt(t.lastAt)}</span>
                    </div>
                    {t.contactDetail && <p className="truncate text-[10px] text-muted-foreground">{t.contactDetail}</p>}
                    <p className="truncate text-[11px] text-muted-foreground">
                      {t.lastItem.subject ? `${t.lastItem.subject} — ` : ''}{t.lastItem.body}
                    </p>
                    <div className="mt-1 flex items-center gap-1">
                      {t.channels.slice(0, 4).map((c) => {
                        const C = CHANNEL_ICON[c];
                        return <C key={c} className="h-3 w-3 text-muted-foreground/70" />;
                      })}
                      {t.counts.failed > 0 && <Badge className="h-4 bg-rose-500/10 px-1 text-[9px] text-rose-600">{t.counts.failed} failed</Badge>}
                      {t.counts.draft > 0 && <Badge className="h-4 bg-muted px-1 text-[9px] text-muted-foreground">{t.counts.draft} draft</Badge>}
                      {t.counts.scheduled > 0 && <Badge className="h-4 bg-amber-500/10 px-1 text-[9px] text-amber-600">{t.counts.scheduled} scheduled</Badge>}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>

      {/* ── Right: conversation + composer ─────────────────────────────────── */}
      <section className={cn('flex min-w-0 flex-col', mobilePane === 'list' && 'hidden lg:flex')}>
        {selected ? (
          <>
            <div className="flex items-center gap-3 border-b px-4 py-3">
              <button onClick={() => setMobilePane('list')} className="rounded-lg p-1 text-muted-foreground hover:bg-muted lg:hidden"><ChevronLeft className="h-4 w-4" /></button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{selected.contactName}</p>
                <p className="truncate text-[11px] text-muted-foreground">{selected.contactDetail ?? selected.key}</p>
              </div>
              <div className="flex gap-1">
                {selected.channels.map((c) => {
                  const Icon = CHANNEL_ICON[c];
                  return <span key={c} className={cn('flex h-6 w-6 items-center justify-center rounded ring-1', CHANNEL_STYLE[c])} title={c}><Icon className="h-3 w-3" /></span>;
                })}
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4">
              {selectedItems.map((i) => {
                const Icon = CHANNEL_ICON[i.channel];
                return (
                  <Card key={i.id} className={cn('p-3', i.status === 'failed' && 'border-rose-500/40 bg-rose-500/5', i.status === 'draft' && 'border-dashed')}>
                    <div className="flex items-start gap-2.5">
                      <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1', CHANNEL_STYLE[i.channel])}><Icon className="h-3.5 w-3.5" /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {i.channel === 'call' ? 'Call' : i.channel === 'secure' ? 'Encrypted' : COMMS_CHANNEL_LABEL[i.channel as CommsChannel] ?? i.channel}
                          </p>
                          <Badge variant={i.status === 'failed' ? 'outline' : 'secondary'} className="h-4 px-1 text-[9px] capitalize">{i.status}</Badge>
                          {i.mode === 'bulk' && <span className="text-[10px] text-muted-foreground"><Users className="mr-0.5 inline h-3 w-3" />{i.count ?? 0}</span>}
                          <span className="ml-auto text-[10px] text-muted-foreground">{clockAt(i.at)}</span>
                        </div>
                        {i.subject && <p className="mt-1 text-xs font-semibold">{i.subject}</p>}
                        <p className="mt-0.5 whitespace-pre-wrap text-xs text-foreground/85">{i.body}</p>
                        {i.note && <p className="mt-1 text-[10px] text-amber-600">{i.note}</p>}
                        {i.status === 'failed' && (
                          <p className="mt-1.5 text-[10px] text-amber-600">Retry from the composer below with the same text.</p>
                        )}
                        {i.channel !== 'call' && i.channel !== 'secure' && (
                          <button
                            onClick={() => setConfirmDelete(i)}
                            className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-rose-500"
                          >
                            <Trash2 className="h-3 w-3" /> Delete record
                          </button>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
              {selectedItems.length === 0 && <p className="py-8 text-center text-xs text-muted-foreground">Nothing in this folder for this thread.</p>}
            </div>
            <ConversationComposer
              mode={mode}
              thread={selected}
              hasComposioKey={hasComposioKey}
              onSent={(m) => { sendMessage(m); void log({ agentId: mode === 'sales' ? 'a-sales' : 'a-comms', agentName: mode === 'sales' ? 'Atlas' : 'Nova', actor: 'user', kind: 'task', message: `Message sent to ${m.to} via ${COMMS_CHANNEL_LABEL[m.channel as CommsChannel]}.` }); }}
            />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center text-xs text-muted-foreground">
            <InboxIcon className="h-8 w-8 opacity-30" />
            {mode === 'sales'
              ? 'Pick a lead thread — or compose from a row in the pipeline.'
              : 'Pick a thread to see every message, call and chat with that person.'}
          </div>
        )}
      </section>

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirmDelete(null)}>
          <Card className="max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold">Delete this message record?</p>
            <p className="mt-1 text-xs text-muted-foreground">Already-delivered messages stay delivered; the inbox row is removed.</p>
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button size="sm" variant="destructive" onClick={() => { deleteMessage(confirmDelete.id); setConfirmDelete(null); }}>Delete</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

/**
 * The reply composer for the selected thread. Email delivers through Gmail
 * (Composio) or the company SMTP; WhatsApp through Meta Cloud API; SMS and
 * Telegram report honestly when no provider is wired.
 */
function ConversationComposer({
  mode, thread, hasComposioKey, onSent,
}: {
  mode: 'full' | 'sales';
  thread: InboxThread;
  hasComposioKey: boolean;
  onSent: (m: CommsMessage) => void;
}) {
  const { leads, composio, activeWorkspaceId } = useBorga();
  const lead = leads.find((l) => l.email.toLowerCase() === thread.key || l.phone.trim() === thread.key);
  const [channel, setChannel] = useState<CommsChannel>('email');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const address = channel === 'email' ? (lead?.email ?? thread.key) : (lead?.phone ?? thread.key);
  const reachable = !!contactFor(lead ?? { email: thread.key, phone: thread.key } as Lead, channel) || EMAIL_OR_PHONE.test(thread.key);

  const deliver = async (): Promise<{ ok: boolean; note?: string }> => {
    if (channel === 'email') {
      const r = await sendCompanyEmail({ ws: activeWorkspaceId, to: address, subject, body, composioKey: composio.apiKey });
      return r.ok ? { ok: true } : { ok: false, note: r.note ?? 'The email could not be sent.' };
    }
    if (channel === 'whatsapp') {
      try {
        const res = await fetch('/api/borga/whatsapp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
          body: JSON.stringify({ action: 'send', to: address, text: body.trim(), ws: activeWorkspaceId }),
        });
        const d = (await res.json()) as { ok?: boolean; error?: string };
        return d.ok ? { ok: true } : { ok: false, note: d.error ?? 'WhatsApp is not configured — add a WhatsApp access token in Integrations.' };
      } catch { return { ok: false, note: 'Network error reaching the send service.' }; }
    }
    return { ok: false, note: `${COMMS_CHANNEL_LABEL[channel]} has no connected provider yet — save a draft instead.` };
  };

  const send = async () => {
    if (!body.trim() || sending || !reachable) return;
    setSending(true);
    const result = await deliver();
    onSent({
      id: `m-${Date.now()}`,
      channel,
      to: `${thread.contactName} <${address}>`,
      recipients: [address],
      subject: channel === 'email' ? subject.trim() : '',
      body: body.trim(),
      status: result.ok ? 'sent' : 'failed',
      mode: 'single',
      count: 1,
      sentAt: result.ok ? new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : (result.note ?? 'Failed'),
    });
    if (!result.ok) toast({ title: 'Send failed', description: result.note, variant: 'error' });
    setBody('');
    setSubject('');
    setSending(false);
  };

  const saveDraft = () => {
    if (!body.trim()) return;
    onSent({
      id: `m-${Date.now()}`,
      channel, to: `${thread.contactName} <draft>`, recipients: [address],
      subject: channel === 'email' ? subject.trim() : '', body: body.trim(),
      status: 'draft', mode: 'single', count: 1, sentAt: 'Draft',
    });
    setBody(''); setSubject('');
  };

  const channels: CommsChannel[] = mode === 'sales' ? ['email', 'sms', 'whatsapp'] : ['email', 'sms', 'whatsapp', 'telegram'];

  return (
    <div className="border-t bg-muted/20 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        {channels.map((c) => {
          const Icon = CHANNEL_ICON[c];
          return (
            <button
              key={c}
              onClick={() => setChannel(c)}
              className={cn('flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors', channel === c ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:border-muted-foreground/40')}
            >
              <Icon className="h-3 w-3" /> {COMMS_CHANNEL_LABEL[c]}
            </button>
          );
        })}
        <span className="ml-auto truncate text-[10px] text-muted-foreground">to {address}</span>
      </div>
      {channel === 'email' && (
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="mb-1.5 h-8 text-xs" />
      )}
      <Textarea
        rows={mode === 'sales' ? 3 : 2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={reachable ? `Reply to ${thread.contactName}…` : `No ${channel === 'email' ? 'email address' : 'phone number'} on file for this thread — type one in the lead record first.`}
        className="text-xs"
      />
      <div className="mt-1.5 flex items-center gap-1.5">
        <Button size="sm" variant="outline" onClick={saveDraft} disabled={!body.trim() || sending}>Save draft</Button>
        <Button size="sm" onClick={() => void send()} disabled={!body.trim() || !reachable || sending} className="gap-1.5">
          {sending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send
        </Button>
        {!hasComposioKey && channel === 'email' && <span className="text-[10px] text-muted-foreground">Email uses the company SMTP or Composio key</span>}
      </div>
    </div>
  );
}

const EMAIL_OR_PHONE = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$|\+?\d[\d\s().-]{6,}/;
