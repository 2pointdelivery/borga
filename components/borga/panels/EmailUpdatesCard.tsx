'use client';

import { useCallback, useEffect, useState } from 'react';
import { Mail, Loader2, Send, X, Plus, AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';
import type { DigestFrequency, EmailEventDef, EmailEventId, EmailSettings } from '@/lib/borga/email-core';

interface State {
  featureOn: boolean;
  smtpConfigured: boolean;
  settings: EmailSettings;
  appUrl: string | null;
  ownerEmail: string | null;
  events: EmailEventDef[];
  log: Array<{ at: string; event: string; subject: string; recipients: number; sent: number; ok: boolean; note?: string }>;
}

const HEADERS = { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' };
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;
const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

/** Per-company email updates: who gets what, when, and a view of what was sent. */
export function EmailUpdatesCard() {
  const { activeWorkspaceId: ws, activeWorkspace } = useBorga();
  const [s, setS] = useState<State | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const url = `/api/borga/email?ws=${encodeURIComponent(ws)}`;

  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      const j = (await r.json()) as State & { ok: boolean };
      if (j.ok) {
        setS(j);
        setReplyTo(j.settings.replyTo);
      }
    } catch {
      /* card stays hidden */
    }
  }, [url]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async (b: Record<string, unknown>) => (await (await fetch(url, { method: 'POST', headers: HEADERS, body: JSON.stringify(b) })).json()) as Record<string, unknown> & { ok: boolean; error?: string };

  if (!s || !s.featureOn) return null;
  const set = s.settings;

  const save = async (patch: Partial<EmailSettings>) => {
    setS({ ...s, settings: { ...set, ...patch, events: { ...set.events, ...(patch.events ?? {}) }, digest: { ...set.digest, ...(patch.digest ?? {}) } } });
    const r = await post({ action: 'saveSettings', settings: patch });
    if (!r.ok) toast({ title: 'Not saved', description: r.error, variant: 'error' });
    void load();
  };

  const addRecipient = () => {
    const e = draft.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) return toast({ title: 'That is not a valid email address', variant: 'warning' });
    if (set.recipients.includes(e)) return setDraft('');
    void save({ recipients: [...set.recipients, e] });
    setDraft('');
  };

  const run = async (name: 'sendTest' | 'digestNow') => {
    setBusy(name);
    const r = await post({ action: name });
    setBusy(null);
    if (r.ok) toast({ title: name === 'sendTest' ? 'Test email sent' : 'Digest sent', description: `To ${String((r.to as string[] | undefined)?.join(', ') ?? set.recipients.join(', '))}`, variant: 'success' });
    else toast({ title: name === 'sendTest' ? 'Test email not sent' : 'Digest not sent', description: r.error, variant: 'error' });
    void load();
  };

  const wsName = activeWorkspace()?.name ?? 'this company';

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Mail className="h-4 w-4 text-primary" /> Email updates for {wsName}
          <Badge variant={set.enabled ? 'secondary' : 'outline'}>{set.enabled ? 'On' : 'Off'}</Badge>
        </div>
        <Switch checked={set.enabled} onCheckedChange={(v) => save({ enabled: v })} aria-label="Turn email updates on or off" />
      </div>
      <p className="text-xs text-muted-foreground">
        Transactional emails and a digest for this company only. Other companies on your account have their own recipients and switches. Nothing is sent while this is off.
      </p>

      {!s.smtpConfigured && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Outgoing email (SMTP) is not configured, so nothing can be delivered. Add the SMTP settings under Integrations → AI &amp; Voice, then send a test email here.
        </p>
      )}
      {!s.appUrl && <p className="text-[11px] text-muted-foreground">Links back to Borga appear in emails once the public address is known. It is remembered when you save here from your browser, or set <code>APP_URL</code> on the server.</p>}

      <div className="space-y-2">
        <p className="text-sm font-medium">Recipients</p>
        <div className="flex flex-wrap gap-1.5">
          {set.recipients.map((r) => (
            <span key={r} className="flex items-center gap-1 rounded-full border bg-muted/30 px-2.5 py-1 text-xs">
              {r}
              <button type="button" aria-label={`Remove ${r}`} className="text-muted-foreground hover:text-rose-600" onClick={() => save({ recipients: set.recipients.filter((x) => x !== r) })}><X className="h-3 w-3" /></button>
            </span>
          ))}
          {set.recipients.length === 0 && <span className="text-xs text-muted-foreground">No recipients yet{s.ownerEmail ? `. Turning updates on adds ${s.ownerEmail}.` : '.'}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addRecipient()} placeholder="Add an email address" className="h-8 max-w-xs" />
          <Button size="sm" variant="outline" className="gap-1" onClick={addRecipient} disabled={!draft.trim()}><Plus className="h-3.5 w-3.5" /> Add</Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => run('sendTest')} disabled={busy !== null}>
            {busy === 'sendTest' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send test email
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground" htmlFor="mail-replyto">Reply-to</label>
          <Input id="mail-replyto" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} onBlur={() => replyTo !== set.replyTo && (replyTo === '' || EMAIL_RE.test(replyTo)) && save({ replyTo })} placeholder="optional, e.g. finance@yourco.com" className="h-8 max-w-xs" />
        </div>
      </div>

      <div className="divide-y rounded-lg border">
        {s.events.map((e) => (
          <label key={e.id} className="flex items-start justify-between gap-4 px-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-sm font-medium">{e.label}</span>
              <span className="block text-xs text-muted-foreground">{e.description}</span>
            </span>
            <Switch checked={set.events[e.id as EmailEventId]} onCheckedChange={(v) => save({ events: { [e.id]: v } as Partial<Record<EmailEventId, boolean>> as EmailSettings['events'] })} />
          </label>
        ))}
      </div>

      <div className="space-y-2 rounded-lg border p-3">
        <p className="text-sm font-medium">Digest</p>
        <p className="text-xs text-muted-foreground">Overdue invoices, bills to pay, pending approvals, support status and this month&apos;s totals, in one email. Sent at the chosen hour in this company&apos;s timezone ({activeWorkspace()?.timezone || 'UTC'}).</p>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={set.digest.frequency} onValueChange={(v) => save({ digest: { frequency: v as DigestFrequency } as EmailSettings['digest'] })}>
            <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="off">No digest</SelectItem>
              <SelectItem value="daily">Every day</SelectItem>
              <SelectItem value="weekly">Mondays</SelectItem>
            </SelectContent>
          </Select>
          <Select value={String(set.digest.hour)} onValueChange={(v) => save({ digest: { hour: Number(v) } as EmailSettings['digest'] })}>
            <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
            <SelectContent>{HOURS.map((h) => <SelectItem key={h} value={String(h)}>{hourLabel(h)}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => run('digestNow')} disabled={busy !== null || !set.enabled}>
            {busy === 'digestNow' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send digest now
          </Button>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={set.digest.skipIfEmpty} onCheckedChange={(v) => save({ digest: { skipIfEmpty: v } as EmailSettings['digest'] })} /> Skip the digest when there is nothing that needs attention
        </label>
      </div>

      {s.log.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium">Recent emails ({s.log.length})</summary>
          <ul className="mt-2 divide-y rounded-lg border">
            {s.log.map((l) => (
              <li key={l.at + l.subject} className="flex items-center justify-between gap-3 px-3 py-1.5">
                <span className="min-w-0 truncate">{l.subject}</span>
                <span className={l.ok ? 'shrink-0 text-muted-foreground' : 'shrink-0 text-rose-600'}>{new Date(l.at).toLocaleString()} · {l.sent}/{l.recipients}{l.note ? ` · ${l.note}` : ''}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
