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
import { SectionTitle } from '../bits';
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
    messages, sendMessage, leads, log,
    composio, messagingChannels, setChannelConnected, activeWorkspace,
  } = useBorga();

  const [channelFilter, setChannelFilter] = useState<'all' | CommsChannel>('all');
  const [query, setQuery] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [status, setStatus] = useState<ChannelStatus>({
    email: messagingChannels.find((c) => c.channel === 'email')?.connected ? 'connected' : 'off',
    sms: messagingChannels.find((c) => c.channel === 'sms')?.connected ? 'connected' : 'off',
    whatsapp: messagingChannels.find((c) => c.channel === 'whatsapp')?.connected ? 'connected' : 'off',
    telegram: messagingChannels.find((c) => c.channel === 'telegram')?.connected ? 'connected' : 'off',
  });

  // Keep channel badges in sync with the hydrated workspace config without
  // clobbering an in-flight OAuth handshake.
  useEffect(() => {
    setStatus((prev) => {
      const next = { ...prev };
      for (const cfg of messagingChannels) {
        if (prev[cfg.channel] === 'connecting') continue;
        next[cfg.channel] = cfg.connected ? 'connected' : 'off';
      }
      return next;
    });
  }, [messagingChannels]);

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

  /** Connect a channel's account via composio.dev hosted OAuth + poll for completion. */
  const connectChannel = async (channel: CommsChannel) => {
    const app = CHANNEL_COMPOSIO_APP[channel];
    setStatus((s) => ({ ...s, [channel]: 'connecting' }));
    try {
      const res = await fetch('/api/borga/composio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ action: 'connect', appName: app, entityId: 'workspace-inbox', apiKey: composio.apiKey }),
      });
      const d = (await res.json()) as { ok?: boolean; connection?: { redirectUrl?: string; redirect_url?: string } };
      const redirectUrl = d.connection?.redirectUrl ?? d.connection?.redirect_url;
      if (!d.ok || !redirectUrl) throw new Error('no redirect');
      window.open(redirectUrl, '_blank', 'noopener,noreferrer,width=640,height=720');

      // Poll connected accounts until the toolkit shows ACTIVE (max ~60s).
      let polls = 0;
      const timer = setInterval(async () => {
        polls++;
        if (polls > 30) {
          clearInterval(timer);
          setStatus((s) => ({ ...s, [channel]: 'error' }));
          return;
        }
        try {
            const pr = await fetch('/api/borga/composio', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
              body: JSON.stringify({ action: 'accounts', apiKey: composio.apiKey }),
            });
            const pd = await pr.json() as { ok?: boolean; error?: string; accounts?: { appName?: string; status?: string }[] };
            if (!pd.ok) {
              clearInterval(timer);
              setStatus((s) => ({ ...s, [channel]: 'error' }));
              return;
            }
            const found = pd.accounts?.find(
            (a) => a.appName?.toLowerCase() === app.toLowerCase() && a.status === 'ACTIVE',
          );
          if (found) {
            clearInterval(timer);
            setStatus((s) => ({ ...s, [channel]: 'connected' }));
            setChannelConnected(channel, { connected: true, account: 'OAuth authorized' });
            log({
              agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'sync',
              message: `${COMMS_CHANNEL_LABEL[channel]} inbox linked via composio.dev OAuth.`,
            });
          }
        } catch { /* keep polling */ }
      }, 2000);
    } catch {
      // No Composio key configured, or no auth config for this toolkit yet — never
      // fake a connection; tell the user what's actually missing.
      setStatus((s) => ({ ...s, [channel]: 'error' }));
      setChannelConnected(channel, { connected: false, account: '' });
      log({
        agentId: 'a-borga', agentName: 'Borga', actor: 'system', kind: 'system',
        message: composio.apiKey
          ? `Could not link ${COMMS_CHANNEL_LABEL[channel]} — no Composio auth config found for this toolkit yet. Create one at composio.dev/dashboard → Auth Configs.`
          : `Could not link ${COMMS_CHANNEL_LABEL[channel]} — add a Composio API key in Integrations first.`,
      });
    }
  };

  const disconnectChannel = (channel: CommsChannel) => {
    setStatus((s) => ({ ...s, [channel]: 'off' }));
    setChannelConnected(channel, { connected: false, account: '' });
    log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'system', message: `${COMMS_CHANNEL_LABEL[channel]} disconnected.` });
  };

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
                  <p className="truncate text-[10px] text-muted-foreground">{cfg?.account || cfg?.providerLabel}</p>
                </div>
                {st === 'connected' && <CircleCheck className="h-4 w-4 shrink-0 text-emerald-500" />}
              </div>
              <div className="mt-2.5 flex items-center gap-1.5">
                {st === 'connecting' ? (
                  <Button size="sm" variant="outline" className="h-7 flex-1 gap-1" disabled>
                    <RefreshCw className="h-3 w-3 animate-spin" /> Waiting for OAuth—
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
      {!composio.apiKey && (
        <p className="rounded-lg border border-dashed bg-muted/20 p-2.5 text-[11px] text-muted-foreground">
          Tip — add your composio.dev API key in Tools &amp; Integrations to complete real OAuth handshakes for Gmail, Twilio SMS and Telegram.
        </p>
      )}

      {/* Composer */}
      {composeOpen && (
        <ComposeCard
          onSend={(m) => {
            sendMessage(m);
            setComposeOpen(false);
          }}
          leads={leads.map((l) => ({ id: l.id, name: l.name, email: l.email }))}
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
                  </div>
                </div>
              </div>
            );
          })
        )}
      </Card>
    </div>
  );
}

function ComposeCard({
  onSend,
  leads,
}: {
  onSend: (m: CommsMessage) => void;
  leads: { id: string; name: string; email: string }[];
}) {
  const { log, composio, activeWorkspaceId } = useBorga();
  const [channel, setChannel] = useState<CommsChannel>('email');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  /** Actually attempts delivery through a real provider — email via Composio Gmail,
   * WhatsApp via the Meta Business API route. SMS and Telegram have no provider
   * wired in this app yet, so those are reported as failed rather than faked. */
  const deliver = async (): Promise<{ ok: boolean; note?: string }> => {
    if (channel === 'email') {
      try {
        const res = await fetch('/api/borga/composio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
          body: JSON.stringify({
            action: 'execute', appName: 'GMAIL_SEND_EMAIL', entityId: 'workspace-inbox', apiKey: composio.apiKey,
            params: { recipient_email: to.trim(), subject: subject.trim(), body: body.trim() },
          }),
        });
        const d = (await res.json()) as { ok?: boolean; error?: string };
        return d.ok ? { ok: true } : { ok: false, note: d.error ?? 'Gmail send failed — check the Gmail connection in Integrations.' };
      } catch {
        return { ok: false, note: 'Network error reaching the send service.' };
      }
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
          <Input list="inbox-leads" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@company.com or +1 555 …" className="mt-1" />
          <datalist id="inbox-leads">
            {leads.map((l) => (
              <option key={l.id} value={l.email || l.name}>{l.name}</option>
            ))}
          </datalist>
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
