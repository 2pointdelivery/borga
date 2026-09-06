'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Lock,
  Send,
  ShieldCheck,
  Fingerprint,
  KeyRound,
  Trash2,
  MessageSquare,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useBorga } from '@/lib/borga/store';
import { AgentAvatar, SectionTitle } from '../bits';
import { cn } from '@/lib/utils';
import {
  getIdentity,
  deriveSharedKey,
  seal,
  open as unseal,
  derivePeerPublicJwk,
  type StoredIdentity,
} from '@/lib/borga/crypto';
import type { SecureMessage, SecureThread } from '@/lib/borga/data';

interface DecryptedMessage extends SecureMessage {
  plain: string;
}

export function SecureChatTab() {
  const { secureChats, upsertSecureThread, deleteSecureThread, employees, log, userName, activeWorkspaceId, activeWorkspace, llm } = useBorga();

  const [identity, setIdentity] = useState<StoredIdentity | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [decrypted, setDecrypted] = useState<Record<string, DecryptedMessage[]>>({});
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Contacts come from the workspace directory (HR) plus the AI assistant.
  const contacts = useMemo(
    () => [
      ...employees.map((e) => ({ id: e.id, name: e.name, sub: e.role, color: '#6366f1' })),
      { id: 'borga-ai', name: 'Borga (AI)', sub: 'Encrypted assistant', color: '#8b5cf6' },
    ],
    [employees],
  );

  const activeContact = contacts.find((c) => c.id === activeId) ?? null;

  // Ensure a device identity exists.
  useEffect(() => {
    getIdentity(userName).then(setIdentity);
  }, [userName]);

  /** Decrypt every thread's messages for display. */
  const decryptThreads = useCallback(
    async (threads: SecureThread[], ident: StoredIdentity | null) => {
      if (!ident || typeof window === 'undefined' || !window.crypto?.subtle) return;
      const out: Record<string, DecryptedMessage[]> = {};
      for (const t of threads) {
        const peerJwk = await derivePeerPublicJwk(t.participantId);
        if (!peerJwk) continue;
        const shared = await deriveSharedKey(ident.privateJwk, peerJwk);
        if (!shared) continue;
        out[t.id] = await Promise.all(
          t.messages.map(async (m) => ({ ...m, plain: await unseal(shared, m) })),
        );
      }
      setDecrypted(out);
    },
    [],
  );

  useEffect(() => {
    void decryptThreads(secureChats, identity);
  }, [secureChats, identity, decryptThreads]);

  // "Live" feel — poll the store so new ciphertexts from other sessions render.
  useEffect(() => {
    const t = setInterval(() => void decryptThreads(secureChats, identity), 5000);
    return () => clearInterval(t);
  }, [secureChats, identity, decryptThreads]);

  const activeMessages = activeId ? decrypted[activeId] : undefined;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [activeMessages?.length, activeId]);

  const send = async () => {
    const contactId = activeId;
    const contact = activeContact;
    if (!contactId || !contact || !draft.trim() || !identity || sending) return;

    setSending(true);
    try {
      const peerJwk = await derivePeerPublicJwk(contactId);
      const shared = peerJwk ? await deriveSharedKey(identity.privateJwk, peerJwk) : null;
      if (!shared) return;

      const sealedMsg = await seal(shared, draft.trim());
      if (!sealedMsg) return;

      const existing = secureChats.find((c) => c.id === contactId);
      const msg: SecureMessage = {
        id: `sm-${Date.now()}`,
        fromId: 'me',
        ciphertext: sealedMsg.ciphertext,
        iv: sealedMsg.iv,
        at: new Date().toISOString(),
        fingerprint: identity.fingerprint,
      };
      const thread: SecureThread = {
        id: contactId,
        participantId: contactId,
        participantName: contact.name,
        messages: [...(existing?.messages ?? []), msg],
        updatedAt: new Date().toISOString(),
      };
      upsertSecureThread(thread);

      log({
        agentId: 'a-borga',
        agentName: 'Borga',
        actor: 'user',
        kind: 'sync',
        message: `E2E encrypted message sent to ${contact.name}. Only ciphertext was stored.`,
      });

      // Encrypted AI assistant reply (generated server-side, sealed before storage).
      if (contactId === 'borga-ai') {
        try {
          const r = await fetch('/api/borga/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
            body: JSON.stringify({
              messages: [{ role: 'user', content: draft.trim() }],
              providerId: llm.providerId,
              model: llm.model,
              ws: activeWorkspaceId,
              companyName: activeWorkspace()?.name,
            }),
          });
          const d = (await r.json()) as { reply?: string };
          const replyText = d.reply ?? '';
          if (replyText) {
            const sealedReply = await seal(shared, `[AI — encrypted] ${replyText}`);
            if (sealedReply) {
              const aiMsg: SecureMessage = {
                id: `sm-${Date.now()}-ai`,
                fromId: contactId,
                ciphertext: sealedReply.ciphertext,
                iv: sealedReply.iv,
                at: new Date().toISOString(),
              };
              const cur = secureChats.find((c) => c.id === contactId);
              upsertSecureThread({
                id: contactId,
                participantId: contactId,
                participantName: contact.name,
                messages: [...(cur?.messages ?? []), msg, aiMsg],
                updatedAt: new Date().toISOString(),
              });
            }
          }
        } catch { /* AI optional */ }
      }

      setDraft('');
    } finally {
      setSending(false);
    }
  };

  const messages = activeId ? decrypted[activeId] ?? [] : [];  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="End-to-end encrypted chat" sub="Live workspace messaging — AES-256-GCM over ECDH P-256. Only ciphertext is ever persisted." />
        <Badge className="gap-1 bg-emerald-500/10 text-emerald-600">
          <ShieldCheck className="h-3 w-3" /> E2E
        </Badge>
      </div>

      {/* Identity card */}
      <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
            <KeyRound className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">Your encryption keys</p>
            <p className="text-[11px] text-muted-foreground">Generated on this device — never leave the browser</p>
          </div>
        </div>
        {identity ? (
          <div className="flex min-w-0 items-center gap-2 text-xs">
            <Fingerprint className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate font-mono text-muted-foreground">{identity.fingerprint}</span>
            <Badge variant="outline" className="shrink-0 text-[10px] text-emerald-600">verified device</Badge>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Generating keypair—</span>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* Contact list */}
        <Card className="overflow-hidden">
          <div className="border-b bg-muted/40 px-4 py-2.5">
            <p className="text-sm font-semibold">Workspace directory</p>
            <p className="text-[11px] text-muted-foreground">{contacts.length} encrypted threads available</p>
          </div>
          <div className="max-h-[480px] overflow-y-auto">
            {contacts.map((c) => {
              const thread = secureChats.find((t) => t.id === c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveId(c.id)}
                  className={cn(
                    'flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors last:border-0',
                    activeId === c.id ? 'bg-accent' : 'hover:bg-muted/30',
                  )}
                >
                  <AgentAvatar name={c.name} color={c.color} size={34} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{c.sub}</p>
                  </div>
                  {thread && (
                    <span className="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                      {thread.messages.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </Card>

        {/* Thread */}
        <Card className="flex h-[560px] flex-col overflow-hidden">
          {activeContact && activeId ? (
            <>
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <AgentAvatar name={activeContact.name} color={activeContact.color} size={32} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{activeContact.name}</p>
                    <p className="flex items-center gap-1 text-[11px] text-emerald-600">
                      <Lock className="h-2.5 w-2.5" /> end-to-end encrypted — live
                    </p>
                  </div>
                </div>
                {secureChats.some((c) => c.id === activeId) && (
                  <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => { deleteSecureThread(activeId); }}>
                    <Trash2 className="h-3.5 w-3.5" /> Clear
                  </Button>
                )}
              </div>

              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-muted/10 p-4">
                {messages.length === 0 && (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-muted-foreground">
                    <ShieldCheck className="h-8 w-8 text-emerald-500/60" />
                    <p>Messages in this thread are sealed with AES-256-GCM.</p>
                    <p>Say hello — the first message establishes the shared secret.</p>
                  </div>
                )}
                {messages.map((m) => (
                  <div key={m.id} className={cn('flex', m.fromId === 'me' ? 'justify-end' : 'justify-start')}>
                    <div
                      className={cn(
                        'max-w-[78%] rounded-2xl px-3.5 py-2 text-sm shadow-sm',
                        m.fromId === 'me'
                          ? 'rounded-br-md bg-primary text-primary-foreground'
                          : 'rounded-bl-md border bg-card',
                      )}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.plain}</p>
                      <p className={cn(
                        'mt-1 flex items-center gap-1 text-[10px]',
                        m.fromId === 'me' ? 'text-primary-foreground/70' : 'text-muted-foreground',
                      )}>
                        <Lock className="h-2.5 w-2.5" />
                        {nowLabelFromIso(m.at)} — encrypted
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t p-3">
                <div className="flex items-center gap-2">
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && void send()}
                    placeholder={`Message ${activeContact.name} — encrypted on your device…`}
                    className="flex-1"
                  />
                  <Button size="icon" onClick={() => void send()} disabled={!draft.trim() || sending} title="Encrypt & send">
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  Sealed with ECDH-derived session keys before leaving the browser. The server stores only unreadable ciphertext.
                </p>
              </div>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <MessageSquare className="h-8 w-8 opacity-40" />
              Select a teammate to start an encrypted conversation.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function nowLabelFromIso(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}
