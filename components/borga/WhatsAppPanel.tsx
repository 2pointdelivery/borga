'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  KeyRound,
  Link2,
  MessageCircle,
  PhoneCall,
  Plus,
  QrCode,
  RefreshCw,
  Send,
  Smartphone,
  Sparkles,
  Unplug,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useBorga } from '@/lib/borga/store';
import { COMMS_CHANNEL_COLOR, type ChatChannel, type ChatThread, type Lead } from '@/lib/borga/data';
import {
  buildWaMeUrl,
  buildWhatsAppWebUrl,
  cleanWhatsAppPhone,
  renderQrDataUrl,
} from '@/lib/borga/whatsapp-qr';
import { SearchSelect } from './SearchSelect';
import { cn } from '@/lib/utils';

const CHANNEL_LABEL: Record<ChatChannel, string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'Email',
  telegram: 'Telegram',
};

type WhatsAppModalTab = 'threads' | 'qr' | 'web';

export function WhatsAppPanel({
  open,
  onOpenChange,
  initialLeadId,
  initialTab = 'threads',
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialLeadId?: string;
  initialTab?: WhatsAppModalTab;
}) {
  const { whatsapp, setWhatsapp, chats, sendChat, addChat, leads, log, connectApp, activeWorkspaceId } = useBorga();
  const [tab, setTab] = useState<WhatsAppModalTab>(initialTab);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [newLeadId, setNewLeadId] = useState<string>('');
  const [adding, setAdding] = useState(false);

  // QR & Device Pairing state
  const [qrMode, setQrMode] = useState<'pair-device' | 'lead-chat'>('pair-device');
  const [pairPhone, setPairPhone] = useState(whatsapp.phone && whatsapp.phone !== 'Demo number (not linked)' ? whatsapp.phone : '');
  const [pairedDevice, setPairedDevice] = useState(whatsapp.pairedDevice ?? 'Sales Pipeline — WhatsApp Web');
  const [bridgeUrl, setBridgeUrl] = useState(whatsapp.bridgeUrl ?? '');
  const [selectedLeadId, setSelectedLeadId] = useState<string>(initialLeadId ?? '');
  const [prefillText, setPrefillText] = useState('Hi {{name}}, following up on our conversation — do you have 10 minutes today?');
  const [qrNonce, setQrNonce] = useState<number>(() => Date.now());
  const [pairingBusy, setPairingBusy] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Cloud API token state (optional)
  const [showCloudApi, setShowCloudApi] = useState(false);
  const [cloudToken, setCloudToken] = useState('');
  const [cloudStatus, setCloudStatus] = useState<string | null>(null);

  // Docked WhatsApp Web window reference
  const popupRef = useRef<Window | null>(null);
  const [companionOpen, setCompanionOpen] = useState(false);

  useEffect(() => {
    if (open && initialLeadId) {
      setSelectedLeadId(initialLeadId);
      const matchingThread = chats.find((c) => c.leadId === initialLeadId);
      if (matchingThread) setActiveId(matchingThread.id);
    }
  }, [open, initialLeadId, chats]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (popupRef.current && popupRef.current.closed) {
        popupRef.current = null;
        setCompanionOpen(false);
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, []);

  const active = chats.find((c) => c.id === activeId) ?? chats[0] ?? null;
  const unread = chats.filter((c) => c.messages[c.messages.length - 1]?.role === 'client').length;

  const activeLead = useMemo(() => {
    if (selectedLeadId) return leads.find((l) => l.id === selectedLeadId) ?? null;
    if (active?.leadId) return leads.find((l) => l.id === active.leadId) ?? null;
    return leads.find((l) => l.stage !== 'lost') ?? null;
  }, [selectedLeadId, active, leads]);

  const resolvedGreeting = useMemo(() => {
    const leadName = activeLead?.name?.split(' ')[0] || active?.clientName?.split(' ')[0] || 'there';
    return prefillText.replace(/\{\{\s*name\s*\}\}/gi, leadName);
  }, [prefillText, activeLead, active]);

  const targetPhone = useMemo(() => {
    if (qrMode === 'lead-chat' || tab === 'web') {
      return cleanWhatsAppPhone(activeLead?.phone || active?.contact || pairPhone);
    }
    return cleanWhatsAppPhone(pairPhone || activeLead?.phone || '');
  }, [qrMode, tab, activeLead, active, pairPhone]);

  const qrTargetUrl = useMemo(() => {
    if (qrMode === 'lead-chat') {
      return buildWaMeUrl(targetPhone, resolvedGreeting);
    }
    if (bridgeUrl.trim()) {
      return `${bridgeUrl.trim().replace(/\/+$/, '')}/pair?ws=${encodeURIComponent(activeWorkspaceId)}&t=${qrNonce % 10000}`;
    }
    if (targetPhone) {
      return buildWaMeUrl(targetPhone, 'Linked with Borga Sales Pipeline');
    }
    return `https://web.whatsapp.com/?borga_ws=${encodeURIComponent(activeWorkspaceId)}&s=${qrNonce % 10000}`;
  }, [qrMode, targetPhone, resolvedGreeting, bridgeUrl, activeWorkspaceId, qrNonce]);

  const qrDataUrl = useMemo(() => renderQrDataUrl(qrTargetUrl), [qrTargetUrl]);
  const currentWebUrl = useMemo(
    () => buildWhatsAppWebUrl(targetPhone, tab === 'web' ? resolvedGreeting : undefined),
    [targetPhone, tab, resolvedGreeting],
  );
  const currentWaMeUrl = useMemo(
    () => buildWaMeUrl(targetPhone, resolvedGreeting),
    [targetPhone, resolvedGreeting],
  );

  const openDockedWhatsAppWeb = (url: string = currentWebUrl) => {
    if (typeof window === 'undefined') return;
    const width = 1020;
    const height = 740;
    const left = Math.max(20, window.screenX + window.outerWidth - width - 30);
    const top = Math.max(20, window.screenY + 60);
    const win = window.open(
      url,
      'borga_whatsapp_web',
      `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=yes,status=no,resizable=yes,scrollbars=yes`,
    );
    if (win) {
      popupRef.current = win;
      setCompanionOpen(true);
      win.focus();
    }
  };

  const pairViaQr = async () => {
    setPairingBusy(true);
    const nowLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const cleanPhone = cleanWhatsAppPhone(pairPhone);
    const displayPhone = cleanPhone ? `+${cleanPhone}` : 'WhatsApp Web (QR Linked)';
    const sessionId = `WA-QR-${(cleanPhone.slice(-6) || qrNonce.toString(36).slice(-5)).toUpperCase()}`;

    try {
      await fetch('/api/borga/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'pair-qr',
          phone: displayPhone,
          pairedDevice: pairedDevice.trim() || 'WhatsApp Web (QR Linked)',
          bridgeUrl: bridgeUrl.trim() || undefined,
          ws: activeWorkspaceId,
        }),
      });
    } catch {
      // Offline or unauthenticated demo fallback still updates local store
    }

    setWhatsapp({
      connected: true,
      phone: displayPhone,
      waId: sessionId,
      lastSync: nowLabel,
      mode: 'qr-web',
      pairedDevice: pairedDevice.trim() || 'WhatsApp Web (QR Linked)',
      bridgeUrl: bridgeUrl.trim() || undefined,
    });
    connectApp('cn-whatsapp', {
      status: 'connected',
      account: displayPhone,
      scopes: bridgeUrl.trim() ? 'qr-web + local bridge' : 'qr-web session',
      lastSync: 'Just now',
    });
    log({
      agentId: 'a-sales',
      agentName: 'Atlas',
      actor: 'user',
      kind: 'system',
      message: `WhatsApp Web linked via QR (${displayPhone}) for Sales Pipeline.`,
    });
    setPairingBusy(false);
  };

  const disconnectWhatsApp = async () => {
    try {
      await fetch('/api/borga/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disconnect', ws: activeWorkspaceId }),
      });
    } catch {
      // Ignore network error on disconnect
    }
    setWhatsapp({
      connected: false,
      phone: '',
      waId: '',
      lastSync: '…',
      mode: undefined,
      bridgeUrl: undefined,
      pairedDevice: undefined,
    });
    connectApp('cn-whatsapp', { status: 'off', account: '', lastSync: '…' });
    log({
      agentId: 'a-sales',
      agentName: 'Atlas',
      actor: 'user',
      kind: 'task',
      message: 'WhatsApp connection unlinked.',
    });
  };

  const connectDemoOrDisconnect = () => {
    if (whatsapp.connected) {
      void disconnectWhatsApp();
      return;
    }
    setTab('qr');
  };

  const resync = () => {
    if (!whatsapp.connected) return;
    setWhatsapp({ lastSync: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
    log({
      agentId: 'a-sales',
      agentName: 'Atlas',
      actor: 'agent',
      kind: 'task',
      message: 'Re-synced WhatsApp conversations with the shared inbox.',
    });
  };

  const ensureLeadThread = (lead: Lead): ChatThread => {
    const existing = chats.find((c) => c.leadId === lead.id);
    if (existing) return existing;
    const thread: ChatThread = {
      id: `ch-${Date.now()}`,
      leadId: lead.id,
      clientName: lead.name,
      contact: lead.phone.trim() || lead.email.trim() || `${lead.name} (no phone on file)`,
      channel: 'whatsapp',
      agent: 'Atlas',
      messages: [],
    };
    addChat(thread);
    return thread;
  };

  const submit = () => {
    if (!active || !text.trim()) return;
    const outbound = text.trim();
    sendChat(active.id, outbound, active.agent);
    log({
      agentId: 'a-sales',
      agentName: active.agent,
      actor: 'user',
      kind: 'handoff',
      message: `Replied to ${active.clientName} via ${CHANNEL_LABEL[active.channel]}.`,
    });
    if (whatsapp.connected && cleanWhatsAppPhone(active.contact)) {
      void fetch('/api/borga/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send',
          to: cleanWhatsAppPhone(active.contact),
          text: outbound,
          ws: activeWorkspaceId,
        }),
      }).catch(() => {});
    }
    setText('');
  };

  const sendAndLaunchWhatsAppWeb = () => {
    const lead = activeLead;
    const msg = resolvedGreeting.trim();
    if (lead && msg) {
      const thread = ensureLeadThread(lead);
      sendChat(thread.id, msg, 'Atlas');
      setActiveId(thread.id);
      log({
        agentId: 'a-sales',
        agentName: 'Atlas',
        actor: 'user',
        kind: 'handoff',
        message: `Dispatched WhatsApp Web message to ${lead.name}.`,
      });
    }
    openDockedWhatsAppWeb(buildWhatsAppWebUrl(targetPhone, msg));
  };

  const startThread = () => {
    const lead = leads.find((l) => l.id === newLeadId);
    if (!lead) return;
    const thread: ChatThread = {
      id: `ch-${Date.now()}`,
      leadId: lead.id,
      clientName: lead.name,
      contact: lead.phone.trim() || lead.email.trim() || `${lead.name} (no contact on file)`,
      channel: 'whatsapp',
      agent: 'Atlas',
      messages: [
        {
          id: `cm-${Date.now()}`,
          role: 'agent',
          sender: 'Atlas',
          text: `Hi ${lead.name} — reaching out from our team. How can we help today?`,
          at: 'Just now',
        },
      ],
    };
    addChat(thread);
    setActiveId(thread.id);
    setSelectedLeadId(lead.id);
    setAdding(false);
    setNewLeadId('');
    log({
      agentId: 'a-sales',
      agentName: 'Atlas',
      actor: 'user',
      kind: 'task',
      message: `New WhatsApp thread started with ${lead.name}.`,
    });
  };

  const saveCloudApiConfig = async () => {
    if (!cloudToken.trim()) return;
    setCloudStatus('Verifying token…');
    try {
      const res = await fetch('/api/borga/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'configure',
          accessToken: cloudToken.trim(),
          persistKey: false,
          ws: activeWorkspaceId,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; phone?: string; error?: string };
      if (data.ok) {
        setWhatsapp({
          connected: true,
          phone: data.phone || 'Cloud API Verified',
          waId: 'WABA-CLOUD',
          lastSync: 'Just now',
          mode: 'cloud-api',
        });
        setCloudStatus('Connected to Meta WhatsApp Cloud API.');
      } else {
        setCloudStatus(data.error || 'Could not verify Cloud API credentials.');
      }
    } catch {
      setCloudStatus('Network error verifying Cloud API token.');
    }
  };

  const copyQrLink = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(qrTargetUrl);
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 1800);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setAdding(false);
      }}
    >
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader className="border-b border-border/70 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <DialogTitle className="flex items-center gap-2 text-base font-semibold tracking-tight">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20">
                  <MessageCircle className="h-4 w-4" />
                </span>
                WhatsApp & Customer Messaging
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-xs">
                Manage pipeline threads, link WhatsApp via QR code, or launch WhatsApp Web directly for any lead.
              </DialogDescription>
            </div>

            {/* Segmented Mode Tabs (Hemrock /demo style) */}
            <div className="flex items-center rounded-lg border border-border/80 bg-muted/30 p-0.5">
              {(
                [
                  { id: 'threads', label: 'CRM Threads', icon: MessageCircle, count: chats.length },
                  { id: 'qr', label: 'Scan QR & Link', icon: QrCode },
                  { id: 'web', label: 'WhatsApp Web', icon: Globe },
                ] as const
              ).map((item) => {
                const Icon = item.icon;
                const isActive = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all',
                      isActive
                        ? 'bg-background text-foreground shadow-2xs ring-1 ring-border/70'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{item.label}</span>
                    {'count' in item && typeof item.count === 'number' && (
                      <span className="rounded bg-muted px-1.5 py-px font-mono text-[10px] tabular-nums text-muted-foreground">
                        {item.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </DialogHeader>

        {/* Connection status bar */}
        <div
          className={cn(
            'flex flex-wrap items-center gap-3 rounded-lg border px-3.5 py-2.5',
            whatsapp.connected
              ? 'border-emerald-500/30 bg-emerald-500/[0.04]'
              : 'border-border/80 bg-muted/20',
          )}
        >
          <span
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md ring-1',
              whatsapp.connected
                ? 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/25'
                : 'bg-background text-muted-foreground ring-border/80',
            )}
          >
            <Smartphone className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold tracking-tight">
                {whatsapp.connected ? whatsapp.phone : 'WhatsApp not linked'}
              </p>
              {whatsapp.connected ? (
                <Badge className="gap-1 bg-emerald-500/10 text-[10px] text-emerald-600 ring-1 ring-emerald-500/25">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  {whatsapp.mode === 'qr-web' ? 'QR Linked' : whatsapp.mode === 'cloud-api' ? 'Cloud API' : 'Active'}
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px]">
                  Disconnected
                </Badge>
              )}
              {companionOpen && (
                <Badge className="gap-1 bg-sky-500/10 text-[10px] text-sky-600 ring-1 ring-sky-500/25">
                  <Globe className="h-2.5 w-2.5" /> Web Window Active
                </Badge>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {whatsapp.connected
                ? `${whatsapp.pairedDevice ? `${whatsapp.pairedDevice} · ` : ''}Session ${whatsapp.waId} · synced ${whatsapp.lastSync}`
                : 'Scan the QR code or link your WhatsApp Web session to message pipeline leads directly.'}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => openDockedWhatsAppWeb()}
            >
              <ExternalLink className="h-3 w-3" /> Launch WhatsApp Web
            </Button>
            {whatsapp.connected && (
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={resync}>
                <RefreshCw className="h-3 w-3" /> Sync
              </Button>
            )}
            <Button
              size="sm"
              variant={whatsapp.connected ? 'secondary' : 'default'}
              className="h-7 gap-1.5 text-xs"
              onClick={connectDemoOrDisconnect}
            >
              {whatsapp.connected ? (
                <>
                  <Unplug className="h-3 w-3" /> Disconnect
                </>
              ) : (
                <>
                  <QrCode className="h-3 w-3" /> Pair via QR
                </>
              )}
            </Button>
          </div>
        </div>

        {/* TAB 1: CRM THREADS */}
        {tab === 'threads' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setAdding((v) => !v)}>
                <Plus className="h-3.5 w-3.5" /> New Lead Thread
              </Button>
              {adding && (
                <div className="flex items-center gap-2">
                  <SearchSelect
                    options={leads
                      .filter((l) => l.stage !== 'lost')
                      .map((l) => ({ value: l.id, label: l.name, detail: `${l.company}${l.phone ? ` · ${l.phone}` : ''}` }))}
                    value={newLeadId}
                    onChange={(v) => setNewLeadId(v)}
                    placeholder="Select a lead…"
                    searchPlaceholder="Search leads"
                    clearable={false}
                    className="w-60"
                  />
                  <Button size="sm" className="h-7 text-xs" onClick={startThread} disabled={!newLeadId}>
                    Start Thread
                  </Button>
                </div>
              )}
              <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
                {unread} awaiting reply
              </span>
            </div>

            <div className="grid gap-3 md:grid-cols-[240px_1fr]">
              {/* Thread list */}
              <div className="flex max-h-[380px] flex-col gap-1 overflow-y-auto rounded-lg border border-border/80 bg-muted/15 p-1.5">
                {chats.map((c) => {
                  const last = c.messages[c.messages.length - 1];
                  const pending = last?.role === 'client';
                  const isSelected = active?.id === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setActiveId(c.id);
                        if (c.leadId) setSelectedLeadId(c.leadId);
                      }}
                      className={cn(
                        'flex flex-col items-start gap-1 rounded-md border px-2.5 py-2 text-left transition-colors',
                        isSelected
                          ? 'border-border bg-background shadow-2xs'
                          : 'border-transparent hover:bg-background/60',
                      )}
                    >
                      <span className="flex w-full items-center gap-1.5">
                        <span className="truncate text-xs font-semibold text-foreground">{c.clientName}</span>
                        {pending && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                      </span>
                      <span className="truncate font-mono text-[10px] tabular-nums text-muted-foreground">
                        {c.contact}
                      </span>
                      <div className="flex w-full items-center justify-between gap-1">
                        <Badge className={cn('gap-1 px-1.5 py-0 text-[9px] ring-1', COMMS_CHANNEL_COLOR[c.channel])}>
                          {CHANNEL_LABEL[c.channel]}
                        </Badge>
                        {last && (
                          <span className="text-[10px] text-muted-foreground">{last.at}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
                {chats.length === 0 && (
                  <p className="p-4 text-center text-xs text-muted-foreground">No conversations yet.</p>
                )}
              </div>

              {/* Active thread */}
              <div className="flex h-[380px] flex-col rounded-lg border border-border/80 bg-background">
                {active ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2 border-b border-border/70 bg-muted/15 px-3.5 py-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary ring-1 ring-primary/20">
                        {active.clientName.charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold">{active.clientName}</p>
                        <p className="truncate font-mono text-[10px] tabular-nums text-muted-foreground">
                          {active.contact} · agent {active.agent}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 gap-1 px-2 text-[11px]"
                          onClick={() => {
                            if (active.leadId) setSelectedLeadId(active.leadId);
                            setQrMode('lead-chat');
                            setTab('qr');
                          }}
                          title="Show scannable QR code for this contact"
                        >
                          <QrCode className="h-3 w-3" /> QR
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 gap-1 px-2 text-[11px]"
                          onClick={() =>
                            openDockedWhatsAppWeb(
                              buildWhatsAppWebUrl(active.contact, text.trim() || undefined),
                            )
                          }
                          title="Open this conversation in WhatsApp Web"
                        >
                          <Globe className="h-3 w-3 text-emerald-600" /> WhatsApp Web
                        </Button>
                      </div>
                    </div>

                    <div className="flex-1 space-y-2 overflow-y-auto p-3.5">
                      {active.messages.map((m) => (
                        <div key={m.id} className={cn('flex', m.role === 'agent' ? 'justify-end' : 'justify-start')}>
                          <div
                            className={cn(
                              'max-w-[78%] rounded-lg px-3 py-2 text-xs leading-relaxed',
                              m.role === 'agent'
                                ? 'rounded-br-xs bg-foreground text-background'
                                : 'rounded-bl-xs border border-border/80 bg-muted/30 text-foreground',
                            )}
                          >
                            <p className="whitespace-pre-wrap break-words">{m.text}</p>
                            <p
                              className={cn(
                                'mt-1 font-mono text-[9px] tabular-nums',
                                m.role === 'agent' ? 'text-background/70' : 'text-muted-foreground',
                              )}
                            >
                              {m.sender} · {m.at}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center gap-2 border-t border-border/70 bg-muted/10 p-2">
                      <Input
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') submit();
                        }}
                        placeholder={`Message ${active.clientName} as ${active.agent}…`}
                        className="h-8 text-xs"
                      />
                      <Button
                        size="sm"
                        className="h-8 gap-1.5 px-3 text-xs"
                        onClick={submit}
                        disabled={!text.trim()}
                      >
                        <Send className="h-3.5 w-3.5" /> Send
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
                    Select or start a conversation to message a pipeline lead.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: SCAN QR & LINK DEVICE */}
        {tab === 'qr' && (
          <div className="grid gap-4 md:grid-cols-[260px_1fr]">
            {/* Left column: Scannable ISO 18004 QR Code Card */}
            <div className="flex flex-col items-center justify-between rounded-lg border border-border/80 bg-muted/15 p-4 text-center">
              <div className="flex w-full items-center justify-between">
                <Badge variant="secondary" className="font-mono text-[10px] tabular-nums">
                  {qrMode === 'pair-device' ? 'DEVICE LINK QR' : 'LEAD DIRECT QR'}
                </Badge>
                <button
                  type="button"
                  onClick={() => setQrNonce(Date.now())}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="Refresh QR code"
                >
                  <RefreshCw className="h-3 w-3" /> Refresh
                </button>
              </div>

              <div className="my-3 rounded-xl border border-border/80 bg-white p-3 shadow-2xs">
                <img
                  src={qrDataUrl}
                  alt="Scannable WhatsApp QR code"
                  className="h-44 w-44 select-none"
                />
              </div>

              <div className="w-full space-y-1.5">
                <p className="text-xs font-medium text-foreground">
                  {qrMode === 'pair-device'
                    ? 'Scan with WhatsApp on your phone'
                    : `Scan to message ${activeLead?.name || 'selected lead'}`}
                </p>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {qrMode === 'pair-device'
                    ? 'Open WhatsApp → Settings → Linked Devices → Link a Device, or scan with your camera to open WhatsApp.'
                    : 'Point your phone camera at this QR code to open WhatsApp with the lead phone and greeting pre-filled.'}
                </p>
                <div className="flex items-center justify-center gap-1.5 pt-1">
                  <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" onClick={copyQrLink}>
                    {copiedUrl ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                    {copiedUrl ? 'Copied' : 'Copy Link'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-[11px]"
                    onClick={() => openDockedWhatsAppWeb(qrMode === 'lead-chat' ? currentWebUrl : 'https://web.whatsapp.com/')}
                  >
                    <ExternalLink className="h-3 w-3" /> Open Web
                  </Button>
                </div>
              </div>
            </div>

            {/* Right column: Pairing configuration & Lead QR selector */}
            <div className="flex flex-col justify-between space-y-4 rounded-lg border border-border/80 bg-background p-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    QR Connection Mode
                  </span>
                  <div className="flex rounded-md border border-border/80 bg-muted/30 p-0.5">
                    <button
                      type="button"
                      onClick={() => setQrMode('pair-device')}
                      className={cn(
                        'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                        qrMode === 'pair-device' ? 'bg-background text-foreground shadow-2xs' : 'text-muted-foreground',
                      )}
                    >
                      Pair Workspace Device
                    </button>
                    <button
                      type="button"
                      onClick={() => setQrMode('lead-chat')}
                      className={cn(
                        'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                        qrMode === 'lead-chat' ? 'bg-background text-foreground shadow-2xs' : 'text-muted-foreground',
                      )}
                    >
                      Lead Chat QR
                    </button>
                  </div>
                </div>

                {qrMode === 'pair-device' ? (
                  <div className="space-y-3 pt-1">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-muted-foreground">
                          WhatsApp Business / Team Number
                        </label>
                        <Input
                          value={pairPhone}
                          onChange={(e) => setPairPhone(e.target.value)}
                          placeholder="+1 (555) 234-5678"
                          className="h-8 font-mono text-xs tabular-nums"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-muted-foreground">
                          Device / Rep Label
                        </label>
                        <Input
                          value={pairedDevice}
                          onChange={(e) => setPairedDevice(e.target.value)}
                          placeholder="Sales Pipeline — WhatsApp Web"
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                        <span>Optional WhatsApp Web Bridge URL (Baileys / WWebJS / Self-Hosted)</span>
                        <span className="font-mono text-[10px]">Optional</span>
                      </label>
                      <Input
                        value={bridgeUrl}
                        onChange={(e) => setBridgeUrl(e.target.value)}
                        placeholder="http://localhost:3001 (leave blank for direct web.whatsapp.com handoff)"
                        className="h-8 font-mono text-xs"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        className="h-8 gap-1.5 text-xs"
                        onClick={pairViaQr}
                        disabled={pairingBusy}
                      >
                        <Link2 className="h-3.5 w-3.5" />
                        {whatsapp.connected && whatsapp.mode === 'qr-web'
                          ? 'Update Linked QR Session'
                          : 'Link WhatsApp Session'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 text-xs"
                        onClick={() => {
                          void pairViaQr();
                          openDockedWhatsAppWeb('https://web.whatsapp.com/');
                        }}
                      >
                        <Globe className="h-3.5 w-3.5 text-emerald-600" /> Link & Open WhatsApp Web
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 pt-1">
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-muted-foreground">
                        Pipeline Lead
                      </label>
                      <SearchSelect
                        options={leads.map((l) => ({
                          value: l.id,
                          label: l.name,
                          detail: `${l.company} · ${l.phone || 'No phone'}`,
                        }))}
                        value={activeLead?.id ?? ''}
                        onChange={(v) => setSelectedLeadId(v)}
                        placeholder="Select a pipeline lead…"
                        searchPlaceholder="Search pipeline leads"
                        clearable={false}
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-muted-foreground">
                        Pre-filled WhatsApp Greeting (supports {'{{name}}'})
                      </label>
                      <Input
                        value={prefillText}
                        onChange={(e) => setPrefillText(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={sendAndLaunchWhatsAppWeb}>
                        <Send className="h-3.5 w-3.5" /> Open in WhatsApp Web & Log to CRM
                      </Button>
                      <a
                        href={currentWaMeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/80 bg-background px-3 text-xs font-medium hover:bg-muted"
                      >
                        <PhoneCall className="h-3.5 w-3.5 text-emerald-600" /> Open wa.me Link
                      </a>
                    </div>
                  </div>
                )}
              </div>

              {/* Collapsible Cloud API section */}
              <div className="border-t border-border/70 pt-3">
                <button
                  type="button"
                  onClick={() => setShowCloudApi((v) => !v)}
                  className="flex w-full items-center justify-between text-left text-[11px] font-medium text-muted-foreground hover:text-foreground"
                >
                  <span className="flex items-center gap-1.5">
                    <KeyRound className="h-3 w-3" /> Using Meta WhatsApp Business Cloud API instead?
                  </span>
                  <span>{showCloudApi ? 'Hide' : 'Configure token →'}</span>
                </button>
                {showCloudApi && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Input
                      type="password"
                      value={cloudToken}
                      onChange={(e) => setCloudToken(e.target.value)}
                      placeholder="Paste Meta Graph API Access Token (EAAG…)"
                      className="h-7 flex-1 font-mono text-xs"
                    />
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={saveCloudApiConfig}>
                      Verify Token
                    </Button>
                    {cloudStatus && (
                      <p className="w-full text-[11px] text-muted-foreground">{cloudStatus}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: WHATSAPP WEB IN-APP COMPANION & LAUNCHER */}
        {tab === 'web' && (
          <div className="space-y-3">
            {/* Lead & Quick Message Bar */}
            <div className="grid gap-2.5 rounded-lg border border-border/80 bg-muted/15 p-3 md:grid-cols-[240px_1fr_auto]">
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Active Pipeline Lead
                </label>
                <SearchSelect
                  options={leads.map((l) => ({
                    value: l.id,
                    label: l.name,
                    detail: `${l.company} · ${l.phone || 'No phone'}`,
                  }))}
                  value={activeLead?.id ?? ''}
                  onChange={(v) => setSelectedLeadId(v)}
                  placeholder="Choose lead…"
                  searchPlaceholder="Search leads"
                  clearable={false}
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Quick Compose to WhatsApp Web ({targetPhone ? `+${targetPhone}` : 'No phone on lead'})
                </label>
                <Input
                  value={prefillText}
                  onChange={(e) => setPrefillText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') sendAndLaunchWhatsAppWeb();
                  }}
                  placeholder="Type a message to pre-fill in WhatsApp Web…"
                  className="h-8 text-xs"
                />
              </div>
              <div className="flex items-end gap-1.5">
                <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={sendAndLaunchWhatsAppWeb}>
                  <Send className="h-3.5 w-3.5" /> Send via WhatsApp Web
                </Button>
              </div>
            </div>

            {/* Embedded Bridge Frame OR Docked WhatsApp Web Companion Workspace */}
            {whatsapp.bridgeUrl && /^https?:\/\//i.test(whatsapp.bridgeUrl) ? (
              <div className="overflow-hidden rounded-lg border border-border/80 bg-background">
                <div className="flex items-center justify-between border-b border-border/70 bg-muted/20 px-3 py-1.5 text-[11px]">
                  <span className="font-mono text-muted-foreground">{whatsapp.bridgeUrl}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-2 text-[11px]"
                    onClick={() => openDockedWhatsAppWeb(whatsapp.bridgeUrl)}
                  >
                    <ExternalLink className="h-3 w-3" /> Pop out
                  </Button>
                </div>
                <iframe
                  src={whatsapp.bridgeUrl}
                  title="WhatsApp Web Bridge"
                  className="h-[340px] w-full border-0"
                />
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-[1fr_220px]">
                <div className="flex flex-col justify-between rounded-lg border border-border/80 bg-background p-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20">
                        <Globe className="h-4 w-4" />
                      </span>
                      <div>
                        <h4 className="text-xs font-semibold">
                          WhatsApp Web Companion Window
                        </h4>
                        <p className="text-[11px] text-muted-foreground">
                          Opens <span className="font-mono">web.whatsapp.com</span> in a dedicated docked window synced with your selected pipeline lead.
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 rounded-md border border-border/70 bg-muted/20 p-3">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-medium text-foreground">
                          Target Lead: {activeLead?.name ?? 'None selected'} ({activeLead?.company ?? '—'})
                        </span>
                        <span className="font-mono text-muted-foreground">
                          {targetPhone ? `+${targetPhone}` : 'No phone'}
                        </span>
                      </div>
                      <p className="mt-1.5 line-clamp-2 rounded border border-border/60 bg-background px-2.5 py-1.5 text-xs text-foreground">
                        “{resolvedGreeting}”
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
                    <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={sendAndLaunchWhatsAppWeb}>
                      <Sparkles className="h-3.5 w-3.5" /> Launch & Pre-fill Message
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => openDockedWhatsAppWeb('https://web.whatsapp.com/')}
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Open Inbox (web.whatsapp.com)
                    </Button>
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {companionOpen ? 'Docked window is open' : 'Docked window ready'}
                    </span>
                  </div>
                </div>

                {/* Instant mobile handoff QR for the current message */}
                <div className="flex flex-col items-center justify-center rounded-lg border border-border/80 bg-muted/15 p-3 text-center">
                  <span className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Mobile Handoff QR
                  </span>
                  <div className="rounded-lg border border-border/80 bg-white p-2">
                    <img
                      src={renderQrDataUrl(currentWaMeUrl)}
                      alt="Lead WhatsApp QR"
                      className="h-28 w-28"
                    />
                  </div>
                  <p className="mt-1.5 text-[10px] leading-tight text-muted-foreground">
                    Scan with phone to send this exact reply from mobile WhatsApp
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export type { Lead };
