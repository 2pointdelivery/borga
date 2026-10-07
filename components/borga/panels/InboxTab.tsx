'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Mail,
  MessageSquare,
  MessageCircle,
  Send,
  Inbox as InboxIcon,
  ExternalLink,
  RefreshCw,
  CircleCheck,
  Unplug,
  Search,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  COMMS_CHANNEL_COLOR,
  COMMS_CHANNEL_LABEL,
  type CommsChannel,
  type CommsMessage,
} from '@/lib/borga/data';
import { useBorga } from '@/lib/borga/store';
import { useComposioReady } from '../use-composio-ready';
import { useConnectedApps } from '../use-connected-apps';
import { useConnectionActions } from '../use-connection-actions';
import { connectionIdForToolkit } from '@/lib/borga/connected-apps';
import { sendCompanyEmail } from '@/lib/borga/send-mail-client';
import type { AppConnection } from '@/lib/borga/data';
import { SectionTitle } from '../bits';
import { SearchSelect } from '../SearchSelect';
import { ConfirmDialog } from '../ConfirmDialog';
import { cn } from '@/lib/utils';

const CHANNEL_ICON: Record<CommsChannel, typeof Mail> = {
  email: Mail,
  sms: MessageSquare,
  whatsapp: MessageCircle,
  telegram: Send,
};

// Composio toolkit slug per messaging channel for OAuth account linking.
const CHANNEL_COMPOSIO_APP: Record<CommsChannel, string> = {
  email: 'gmail',
  sms: 'twilio',
  whatsapp: 'whatsapp',
  telegram: 'telegram',
};

type ChannelStatus = Record<CommsChannel, 'connected' | 'connecting' | 'off' | 'error'>;

export function InboxTab() {
  const {
    messages, sendMessage, deleteMessage, leads,
    composio, messagingChannels, connections, activeWorkspaceId, activeWorkspace,
  } = useBorga();

  const [channelFilter, setChannelFilter] = useState<'all' | CommsChannel>('all');
  const [query, setQuery] = useState('');
  // A server-side COMPOSIO_API_KEY counts too, so env-configured keys work here as well.
  const { ready: composioReady } = useComposioReady();
  const hasComposioKey = !!composio.apiKey || composioReady;
  const [composeOpen, setComposeOpen] = useState(false);
  const [retrySeed, setRetrySeed] = useState<{ key: number; to: string; subject: string; body: string; channel: CommsChannel } | null>(null);
  const [confirmDeleteMessage, setConfirmDeleteMessage] = useState<CommsMessage | null>(null);

  const retryMessage = (m: CommsMessage) => {
    setRetrySeed((prev) => ({ key: (prev?.key ?? 0) + 1, to: m.recipients[0] ?? m.to, subject: m.subject, body: m.body, channel: m.channel }));
    setComposeOpen(true);
  };
  // The same live connection state every other screen reads: Gmail connected under Integrations is Gmail here, with nothing to connect twice.
  const { apps } = useConnectedApps();
  const { reconnect, disconnect } = useConnectionActions();
  const [smtp, setSmtp] = useState<{ on: boolean; from: string | null }>({ on: false, from: null });
  useEffect(() => {
    if (!activeWorkspaceId) return;
    let off = false;
    void fetch(`/api/borga/mail?ws=${encodeURIComponent(activeWorkspaceId)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: { ok?: boolean; smtp?: boolean; from?: string | null }) => { if (!off && j.ok) setSmtp({ on: !!j.smtp, from: j.from ?? null }); })
      .catch(() => {});
    return () => { off = true; };
  }, [activeWorkspaceId]);

  const cardFor = (ch: CommsChannel): AppConnection => {
    const app = CHANNEL_COMPOSIO_APP[ch];
    return connections.find((c) => c.id === connectionIdForToolkit(app))
      ?? { id: connectionIdForToolkit(app), type: 'tool', provider: app, label: COMMS_CHANNEL_LABEL[ch], status: 'off', account: '', scopes: '', lastSync: '…' };
  };
  const status = Object.fromEntries((Object.keys(COMMS_CHANNEL_LABEL) as CommsChannel[]).map((ch) => {
    const card = cardFor(ch);
    const live = apps[CHANNEL_COMPOSIO_APP[ch]]?.connected ?? messagingChannels.find((c) => c.channel === ch)?.connected ?? false;
    const st: ChannelStatus[CommsChannel] = card.status === 'connecting' ? 'connecting' : live ? 'connected' : card.status === 'error' ? 'error' : 'off';
    return [ch, st];
  })) as ChannelStatus;

  const filtered = useMemo(
    () =>
      messages.filter((m) => {
        if (channelFilter !== 'all' && m.channel !== channelFilter) return false;
        if (query && !`${m.to} ${m.subject} ${m.body}`.toLowerCase().includes(query.toLowerCase())) return false;
        return true;
      }),
    [messages, channelFilter, query],
  );

  const counts = useMemo(() => {
    const c = { all: messages.length } as Record<string, number>;
    for (const ch of Object.keys(COMMS_CHANNEL_LABEL) as CommsChannel[]) {
      c[ch] = messages.filter((m) => m.channel === ch).length;
    }
    return c;
  }, [messages]);

  const connectChannel = (channel: CommsChannel) => void reconnect(cardFor(channel));
  const disconnectChannel = (channel: CommsChannel) => void disconnect(cardFor(channel));

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle
          title="Unified inbox"
          sub={`${activeWorkspace()?.name ?? 'Workspace'} — email, SMS, WhatsApp and Telegram in one thread list`}
        />
        <Button onClick={() => setComposeOpen((v) => !v)}>
          <Send className="h-4 w-4" /> New message
        </Button>
      </div>

      {/* Channel status cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(Object.keys(COMMS_CHANNEL_LABEL) as CommsChannel[]).map((ch) => {
          const Icon = CHANNEL_ICON[ch];
          const st = status[ch];
          const cfg = messagingChannels.find((c) => c.channel === ch);
          return (
            <Card key={ch} className="p-3.5">
              <div className="flex items-center gap-2">
                <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg ring-1', COMMS_CHANNEL_COLOR[ch])}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{COMMS_CHANNEL_LABEL[ch]}</p>
                  <p className="truncate text-[10px] text-muted-foreground">{ch === 'email' && st !== 'connected' && smtp.on ? `Sends from ${smtp.from ?? 'your mail server'}` : cfg?.account || cfg?.providerLabel}</p>
                </div>
                {st === 'connected' && <CircleCheck className="h-4 w-4 shrink-0 text-emerald-500" />}
              </div>
              <div className="mt-2.5 flex items-center gap-1.5">
                {st === 'connecting' ? (
                  <Button size="sm" variant="outline" className="h-7 flex-1 gap-1" disabled>
                    <RefreshCw className="h-3 w-3 animate-spin" /> Waiting for OAuth…
                  </Button>
                ) : st === 'connected' ? (
                  <>
                    <Badge className="bg-emerald-500/10 text-emerald-600 text-[10px]">linked</Badge>
                    <Button size="sm" variant="ghost" className="ml-auto h-7 gap-1 px-2 text-muted-foreground" onClick={() => disconnectChannel(ch)}>
                      <Unplug className="h-3 w-3" /> Unlink
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant={st === 'error' ? 'outline' : 'default'}
                    className={cn('h-7 flex-1 gap-1', st === 'error' && 'text-destructive')}
                    onClick={() => void connectChannel(ch)}
                  >
                    <ExternalLink className="h-3 w-3" />
                    {st === 'error' ? 'Retry OAuth' : 'Connect via OAuth'}
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      {!hasComposioKey && (
        <p className="rounded-lg border border-dashed bg-muted/20 p-2.5 text-[11px] text-muted-foreground">
          Tip — add your composio.dev API key in Tools &amp; Integrations to complete real OAuth handshakes for Gmail, Twilio SMS and Telegram.
        </p>
      )}

      {/* Composer */}
      {composeOpen && (
        <ComposeCard
          key={retrySeed?.key ?? 'new'}
          onSend={(m) => {
            sendMessage(m);
            setRetrySeed(null);
            setComposeOpen(false);
          }}
          leads={leads.map((l) => ({ id: l.id, name: l.name, email: l.email }))}
          initial={retrySeed ?? undefined}
        />
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setChannelFilter('all')}
          className={cn(
            'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
            channelFilter === 'all' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/60',
          )}
        >
          All ({counts.all})
        </button>
        {(Object.keys(COMMS_CHANNEL_LABEL) as CommsChannel[]).map((ch) => {
          const Icon = CHANNEL_ICON[ch];
          return (
            <button
              key={ch}
              onClick={() => setChannelFilter(ch)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                channelFilter === ch ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/60',
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {COMMS_CHANNEL_LABEL[ch]} ({counts[ch] ?? 0})
            </button>
          );
        })}
        <div className="relative ml-auto w-full sm:w-56">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search inbox…" className="pl-8 text-xs" />
        </div>
      </div>

      {/* Thread list */}
      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-sm text-muted-foreground">
            <InboxIcon className="h-8 w-8 opacity-40" /> Inbox zero — no messages match.
          </div>
        ) : (
          filtered.map((m) => {
            const Icon = CHANNEL_ICON[m.channel];
            return (
              <div key={m.id} className="flex gap-3 border-b px-4 py-3 last:border-0 hover:bg-muted/20">
                <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1', COMMS_CHANNEL_COLOR[m.channel])}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{m.to}</p>
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{m.sentAt}</span>
                  </div>
                  {m.subject && <p className="truncate text-xs font-medium text-foreground/80">{m.subject}</p>}
                  <p className="line-clamp-2 text-xs text-muted-foreground">{m.body}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={cn('rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase ring-1', COMMS_CHANNEL_COLOR[m.channel])}>
                      {COMMS_CHANNEL_LABEL[m.channel]}
                    </span>
                    {m.mode === 'bulk' && <span className="text-[10px] text-muted-foreground">bulk — {m.count} recipients</span>}
                    <Badge variant={m.status === 'sent' ? 'secondary' : 'outline'} className="text-[9px] capitalize">{m.status}</Badge>
                    {m.status === 'failed' && (
                      <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[10px]" onClick={() => retryMessage(m)}>
                        <RotateCcw className="h-3 w-3" /> Retry
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-muted-foreground hover:text-rose-500" title="Delete row" onClick={() => setConfirmDeleteMessage(m)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </Card>

      <ConfirmDialog
        open={!!confirmDeleteMessage}
        onOpenChange={(o) => { if (!o) setConfirmDeleteMessage(null); }}
        title="Delete this message row?"
        description={confirmDeleteMessage ? `The "${confirmDeleteMessage.subject || confirmDeleteMessage.body.slice(0, 60)}" record is removed from the inbox list. Already-delivered messages stay delivered.` : ''}
        confirmLabel="Delete row"
        onConfirm={() => {
          if (!confirmDeleteMessage) return;
          deleteMessage(confirmDeleteMessage.id);
          setConfirmDeleteMessage(null);
        }}
      />
    </div>
  );
}

function ComposeCard({
  onSend,
  leads,
  initial,
}: {
  onSend: (m: CommsMessage) => void;
  leads: { id: string; name: string; email: string }[];
  initial?: { to: string; subject: string; body: string; channel: CommsChannel };
}) {
  const { log, composio, activeWorkspaceId } = useBorga();
  const [channel, setChannel] = useState<CommsChannel>(initial?.channel ?? 'email');
  const [to, setTo] = useState(initial?.to ?? '');
  const [subject, setSubject] = useState(initial?.subject ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [sending, setSending] = useState(false);

  /** Actually attempts delivery through a real provider — email via Composio Gmail,
   * WhatsApp via the Meta Business API route. SMS and Telegram have no provider
   * wired in this app yet, so those are reported as failed rather than faked. */
  const deliver = async (): Promise<{ ok: boolean; note?: string }> => {
    if (channel === 'email') {
      const r = await sendCompanyEmail({ ws: activeWorkspaceId, to, subject, body, composioKey: composio.apiKey });
      return r.ok ? { ok: true } : { ok: false, note: r.note ?? 'The email could not be sent.' };
    }
    if (channel === 'whatsapp') {
      try {
        const res = await fetch('/api/borga/whatsapp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
          body: JSON.stringify({ action: 'send', to: to.trim(), text: body.trim(), ws: activeWorkspaceId }),
        });
        const d = (await res.json()) as { ok?: boolean; error?: string };
        return d.ok ? { ok: true } : { ok: false, note: d.error ?? 'WhatsApp is not configured — add a WhatsApp access token in Integrations.' };
      } catch {
        return { ok: false, note: 'Network error reaching the send service.' };
      }
    }
    // sms / telegram: no provider wired yet — never claim delivery.
    return { ok: false, note: `${COMMS_CHANNEL_LABEL[channel]} has no connected provider yet — this app doesn't send ${channel} directly.` };
  };

  const send = async () => {
    if (!to.trim() || !body.trim() || sending) return;
    setSending(true);
    const result = await deliver();
    onSend({
      id: `msg-${Date.now()}`,
      channel,
      to: to.trim(),
      recipients: [to.trim()],
      subject: subject.trim(),
      body: body.trim(),
      status: result.ok ? 'sent' : 'failed',
      mode: 'single',
      count: 1,
      sentAt: new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    });
    log({
      agentId: 'a-comms', agentName: 'Nova', actor: 'user', kind: result.ok ? 'task' : 'system',
      message: result.ok
        ? `${COMMS_CHANNEL_LABEL[channel]} message delivered to ${to.trim()}.`
        : `${COMMS_CHANNEL_LABEL[channel]} message to ${to.trim()} failed: ${result.note}`,
    });
    setSending(false);
  };

  return (
    <Card className="space-y-3 p-4">
      <SectionTitle title="Compose" sub="Routed through the linked channel accounts above" />
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Channel</label>
          <Select value={channel} onValueChange={(v) => setChannel(v as CommsChannel)}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(COMMS_CHANNEL_LABEL) as CommsChannel[]).map((ch) => (
                <SelectItem key={ch} value={ch}>{COMMS_CHANNEL_LABEL[ch]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-muted-foreground">Recipient</label>
          <SearchSelect
            options={leads.map((l) => ({ value: l.email || l.name, label: l.name, detail: l.email }))}
            value={to}
            onChange={setTo}
            placeholder="name@company.com or +1 555 …"
            searchPlaceholder="Search leads"
            allowCustom
            className="mt-1"
          />
        </div>
      </div>
      {channel === 'email' && (
        <div>
          <label className="text-xs font-medium text-muted-foreground">Subject</label>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Quick check-in" className="mt-1" />
        </div>
      )}
      <div>
        <label className="text-xs font-medium text-muted-foreground">Message</label>
        <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your message…" className="mt-1" />
      </div>
      {(channel === 'sms' || channel === 'telegram') && (
        <p className="rounded-lg border border-dashed bg-muted/20 p-2.5 text-[11px] text-muted-foreground">
          {COMMS_CHANNEL_LABEL[channel]} has no connected provider yet — sending will be recorded as failed. Email (Gmail) and WhatsApp deliver for real.
        </p>
      )}
      <div className="flex justify-end">
        <Button onClick={send} disabled={!to.trim() || !body.trim() || sending} className="gap-1.5">
          {sending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {sending ? 'Sending…' : 'Send now'}
        </Button>
      </div>
    </Card>
  );
}
