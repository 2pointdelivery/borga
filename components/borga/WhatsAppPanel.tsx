'use client';

import { useState } from 'react';
import { MessageCircle, Send, Smartphone, Check, PhoneCall, RefreshCw, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useBorga } from '@/lib/borga/store';
import { COMMS_CHANNEL_COLOR, type ChatChannel, type ChatThread, type Lead } from '@/lib/borga/data';
import { SearchSelect } from './SearchSelect';
import { cn } from '@/lib/utils';

const CHANNEL_LABEL: Record<ChatChannel, string> = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email', telegram: 'Telegram' };

export function WhatsAppPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { whatsapp, setWhatsapp, chats, sendChat, addChat, leads, log, connectApp } = useBorga();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [newLeadId, setNewLeadId] = useState<string>('');
  const [adding, setAdding] = useState(false);

  const active = chats.find((c) => c.id === activeId) ?? chats[0] ?? null;
  const unread = chats.filter((c) => c.messages[c.messages.length - 1]?.role === 'client').length;

  const connect = () => {
    const now = new Date();
    if (whatsapp.connected) {
      setWhatsapp({ connected: false, phone: '', waId: '' });
      connectApp('cn-whatsapp', { status: 'off', account: '', lastSync: '…' });
      log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'user', kind: 'task', message: 'WhatsApp Business connection removed.' });
    } else {
      // Demo mode is honest about what it is: a local stand-in so the team
      // can try the chat flows. The real WhatsApp Business API is wired via
      // Integrations (the same route the inbox composer sends through).
      setWhatsapp({
        connected: true,
        phone: 'Demo number (not linked)',
        waId: 'WABA-DEMO',
        lastSync: `${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      });
      connectApp('cn-whatsapp', { status: 'connected', account: 'Demo number (not linked)', scopes: 'local demo', lastSync: 'Just now' });
      log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'user', kind: 'system', message: 'WhatsApp demo mode enabled — messages stay local. Link the WhatsApp Business API under Integrations for real delivery.' });
    }
  };

  const resync = () => {
    if (!whatsapp.connected) return;
    setWhatsapp({ lastSync: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
    log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'agent', kind: 'task', message: 'Re-synced WhatsApp conversations with the shared inbox.' });
  };

  const submit = () => {
    if (!active || !text.trim()) return;
    sendChat(active.id, text.trim(), active.agent);
    log({ agentId: 'a-sales', agentName: active.agent, actor: 'user', kind: 'handoff', message: `Replied to ${active.clientName} via ${CHANNEL_LABEL[active.channel]}.` });
    setText('');
  };

  const startThread = () => {
    const lead = leads.find((l) => l.id === newLeadId);
    if (!lead) return;
    const thread: ChatThread = {
      id: `ch-${Date.now()}`,
      leadId: lead.id,
      clientName: lead.name,
      // WhatsApp-style threads need a real phone; leads without one start as email-free local threads.
      contact: lead.phone.trim() || lead.email.trim() || `${lead.name} (no contact on file)`,
      channel: 'whatsapp',
      agent: 'Atlas',
      messages: [{ id: `cm-${Date.now()}`, role: 'agent', sender: 'Atlas', text: `Hi ${lead.name} — reaching out from our team. How can we help today?`, at: 'Just now' }],
    };
    addChat(thread);
    setActiveId(thread.id);
    setAdding(false);
    setNewLeadId('');
    log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'user', kind: 'task', message: `New WhatsApp thread started with ${lead.name}.` });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setAdding(false); }}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-green-600" /> Customer chat
          </DialogTitle>
          <DialogDescription>
            Team threads across WhatsApp, SMS, email and Telegram. The business link above tracks demo vs real delivery.
          </DialogDescription>
        </DialogHeader>

        {/* Connection bar */}
        <div className={cn('flex flex-wrap items-center gap-3 rounded-xl border p-3', whatsapp.connected ? 'border-green-500/30 bg-green-500/5' : 'border-muted bg-muted/20')}>
          <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg', whatsapp.connected ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground')}>
            <Smartphone className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold">{whatsapp.connected ? whatsapp.phone : 'WhatsApp Business not connected'}</p>
              {whatsapp.connected && <Badge className="gap-1 bg-green-500/10 text-green-600 ring-1 ring-green-500/30"><Check className="h-3 w-3" /> Live</Badge>}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {whatsapp.connected ? `Business ID ${whatsapp.waId} — last sync ${whatsapp.lastSync}` : 'Connect to route messages from your shared inbox into the CRM.'}
            </p>
          </div>
          <div className="flex gap-2">
            {whatsapp.connected && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={resync}>
                <RefreshCw className="h-3.5 w-3.5" /> Sync
              </Button>
            )}
            <Button size="sm" variant={whatsapp.connected ? 'secondary' : 'default'} onClick={connect} title={whatsapp.connected ? undefined : 'Enables a clearly-labelled demo number; link the real API under Integrations'}>
              <PhoneCall className="h-3.5 w-3.5" /> {whatsapp.connected ? 'Disconnect' : 'Try demo number'}
            </Button>
          </div>
        </div>

        {/* New thread */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAdding((v) => !v)}>
            <Plus className="h-3.5 w-3.5" /> Start new thread
          </Button>
          {adding && (
            <div className="flex items-center gap-2">
              <SearchSelect
                options={leads.filter((l) => l.stage !== 'lost').map((l) => ({ value: l.id, label: l.name, detail: l.company }))}
                value={newLeadId}
                onChange={(v) => setNewLeadId(v)}
                placeholder="Select a lead…"
                searchPlaceholder="Search leads"
                clearable={false}
                className="w-52"
              />
              <Button size="sm" onClick={startThread} disabled={!newLeadId}>Open</Button>
            </div>
          )}
          <span className="ml-auto text-[11px] text-muted-foreground">{unread} threads with a pending client message</span>
        </div>

        {/* Chat area */}
        <div className="grid gap-3 md:grid-cols-[220px_1fr]">
          {/* Thread list */}
          <div className="flex flex-col gap-1.5 rounded-xl border bg-muted/20 p-1.5">
            {chats.map((c) => {
              const last = c.messages[c.messages.length - 1];
              const pending = last?.role === 'client';
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveId(c.id)}
                  className={cn(
                    'flex flex-col items-start gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
                    active?.id === c.id ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-muted',
                  )}
                >
                  <span className="flex w-full items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{c.clientName}</span>
                    {pending && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{c.contact}</span>
                  <Badge className={cn('gap-1 text-[9px] ring-1', COMMS_CHANNEL_COLOR[c.channel])}>
                    {c.channel === 'whatsapp' ? <MessageCircle className="h-2.5 w-2.5" /> : null}
                    {CHANNEL_LABEL[c.channel]}
                  </Badge>
                </button>
              );
            })}
            {chats.length === 0 && <p className="p-3 text-xs text-muted-foreground">No conversations yet.</p>}
          </div>

          {/* Active thread */}
          <div className="flex h-[360px] flex-col rounded-xl border bg-muted/20">
            {active ? (
              <>
                <div className="flex items-center gap-2 border-b px-3 py-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                    {active.clientName.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{active.clientName}</p>
                    <p className="truncate text-[10px] text-muted-foreground">{active.contact} — replying as {active.agent}</p>
                  </div>
                  <Badge className={cn('gap-1 ring-1', COMMS_CHANNEL_COLOR[active.channel])}>{CHANNEL_LABEL[active.channel]}</Badge>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto p-3">
                  {active.messages.map((m) => (
                    <div key={m.id} className={cn('flex', m.role === 'agent' ? 'justify-end' : 'justify-start')}>
                      <div
                        className={cn(
                          'max-w-[80%] rounded-xl px-3 py-2 text-sm',
                          m.role === 'agent' ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm bg-card text-foreground ring-1 ring-border',
                        )}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.text}</p>
                        <p className={cn('mt-0.5 text-[9px]', m.role === 'agent' ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                          {m.sender} — {m.at}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 border-t p-2">
                  <Input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                    placeholder={`Reply as ${active.agent}…`}
                    className="h-9"
                  />
                  <Button size="icon" className="h-9 w-9" onClick={submit} disabled={!text.trim()}>
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
                Select or start a conversation to chat with a client.
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export type { Lead };
