'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, Mail, Timer, RefreshCw, Copy, KeyRound } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';
import { ticketsApi, type ClientSettings } from '@/lib/borga/tickets-client';
import { TICKET_PRIORITIES, fmtDuration, type SlaPolicy, type TicketPriority } from '@/lib/borga/tickets';
import { SectionTitle } from '../bits';
import { Field } from '../form-widgets';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function copy(text: string) {
  void navigator.clipboard?.writeText(text).then(() => toast({ title: 'Copied', variant: 'success' }));
}

export function TicketSettingsTab() {
  const { activeWorkspaceId: ws } = useBorga();
  const [s, setS] = useState<ClientSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imapPassword, setImapPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    let live = true;
    void ticketsApi.list(ws).then((r) => {
      if (!live) return;
      if (r.ok) setS(r.settings);
      else setError(r.error ?? 'Could not load settings');
    });
    return () => {
      live = false;
    };
  }, [ws]);

  if (!s) {
    return error ? <Card className="p-6 text-sm text-muted-foreground">{error}</Card> : <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  const setMailbox = (patch: Partial<ClientSettings['mailbox']>) => setS({ ...s, mailbox: { ...s.mailbox, ...patch } });
  const setPolicy = (id: string, fn: (p: SlaPolicy) => SlaPolicy) => setS({ ...s, slaPolicies: s.slaPolicies.map((p) => (p.id === id ? fn(p) : p)) });

  const save = async (opts: { regenerateToken?: boolean } = {}) => {
    setSaving(true);
    const { keyPrefix, defaultSlaPolicyId, escalationEmail, businessHours, slaPolicies, mailbox } = s;
    const mb = { enabled: mailbox.enabled, address: mailbox.address, displayName: mailbox.displayName, imapHost: mailbox.imapHost, imapPort: mailbox.imapPort, imapSecure: mailbox.imapSecure, imapUser: mailbox.imapUser, folder: mailbox.folder, autoAck: mailbox.autoAck };
    const r = await ticketsApi.saveSettings(ws, { keyPrefix, defaultSlaPolicyId, escalationEmail, businessHours, slaPolicies, mailbox: mb }, { imapPassword: imapPassword || undefined, regenerateToken: opts.regenerateToken });
    setSaving(false);
    if (!r.ok) return toast({ title: 'Not saved', description: r.issues?.join('; ') ?? r.error, variant: 'error' });
    setS(r.settings);
    setImapPassword('');
    toast({ title: 'Support settings saved', variant: 'success' });
  };

  const poll = async () => {
    setPolling(true);
    const r = await ticketsApi.pollMailbox(ws);
    setPolling(false);
    const fresh = await ticketsApi.list(ws);
    if (fresh.ok) setS(fresh.settings);
    if (!r.ok) return toast({ title: 'Mailbox check failed', description: r.error, variant: 'error' });
    toast({ title: 'Mailbox checked', description: `${r.fetched} new message(s): ${r.created} ticket(s) opened, ${r.replied} repl${r.replied === 1 ? 'y' : 'ies'} threaded.`, variant: 'success' });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle title="SLA & Mailbox" sub="Response and resolution targets, working hours and the mailbox that feeds the desk" />
        <Button onClick={() => save()} disabled={saving} className="gap-1.5">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save all</Button>
      </div>

      <Card className="space-y-4 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold"><Timer className="h-4 w-4 text-primary" /> SLA policies</div>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Ticket key prefix" hint="Appears in subjects as [SUP-12]"><Input value={s.keyPrefix} onChange={(e) => setS({ ...s, keyPrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) })} /></Field>
          <Field label="Default policy">
            <Select value={s.defaultSlaPolicyId} onValueChange={(v) => setS({ ...s, defaultSlaPolicyId: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{s.slaPolicies.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Escalation email" hint="Emailed when a ticket breaches"><Input type="email" value={s.escalationEmail} onChange={(e) => setS({ ...s, escalationEmail: e.target.value })} placeholder="oncall@yourco.com" /></Field>
        </div>

        {s.slaPolicies.map((p) => (
          <div key={p.id} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Input value={p.name} onChange={(e) => setPolicy(p.id, (x) => ({ ...x, name: e.target.value }))} className="h-8 max-w-64 font-medium" />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={p.businessHoursOnly} onCheckedChange={(v) => setPolicy(p.id, (x) => ({ ...x, businessHoursOnly: v }))} /> Business hours only
              </label>
            </div>
            <div className="mt-3 grid grid-cols-[90px_1fr_1fr] items-center gap-2 text-xs">
              <span />
              <span className="text-muted-foreground">First response (minutes)</span>
              <span className="text-muted-foreground">Resolution (minutes)</span>
              {TICKET_PRIORITIES.map((pr: TicketPriority) => (
                <div key={pr} className="contents">
                  <span className="font-medium capitalize">{pr}</span>
                  {(['firstResponseMin', 'resolutionMin'] as const).map((k) => (
                    <div key={k} className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={1}
                        value={p.targets[pr][k]}
                        onChange={(e) => setPolicy(p.id, (x) => ({ ...x, targets: { ...x.targets, [pr]: { ...x.targets[pr], [k]: Math.max(1, Math.round(Number(e.target.value) || 1)) } } }))}
                        className="h-8"
                      />
                      <span className="w-14 shrink-0 text-muted-foreground">{fmtDuration(p.targets[pr][k])}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}

        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Business hours (used by policies set to business hours only)</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex gap-1">
              {DAYS.map((d, i) => (
                <Button
                  key={d}
                  size="sm"
                  variant={s.businessHours.days.includes(i) ? 'default' : 'outline'}
                  className="h-8 px-2.5"
                  onClick={() => setS({ ...s, businessHours: { ...s.businessHours, days: s.businessHours.days.includes(i) ? s.businessHours.days.filter((x) => x !== i) : [...s.businessHours.days, i].sort() } })}
                >
                  {d}
                </Button>
              ))}
            </div>
            <Field label="From"><Input type="time" value={s.businessHours.start} onChange={(e) => setS({ ...s, businessHours: { ...s.businessHours, start: e.target.value } })} className="w-28" /></Field>
            <Field label="To"><Input type="time" value={s.businessHours.end} onChange={(e) => setS({ ...s, businessHours: { ...s.businessHours, end: e.target.value } })} className="w-28" /></Field>
            <Field label="UTC offset (hours)"><Input type="number" step={0.5} min={-12} max={14} value={s.businessHours.utcOffsetMin / 60} onChange={(e) => setS({ ...s, businessHours: { ...s.businessHours, utcOffsetMin: Math.round((Number(e.target.value) || 0) * 60) } })} className="w-28" /></Field>
          </div>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold"><Mail className="h-4 w-4 text-primary" /> Linked mailbox</div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={s.mailbox.enabled} onCheckedChange={(v) => setMailbox({ enabled: v })} /> {s.mailbox.enabled ? 'On' : 'Off'}
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          New emails open tickets; replies carrying <code>[{s.keyPrefix}-n]</code> or matching In-Reply-To headers join the existing thread. Agent replies go out over your SMTP settings (Integrations → AI &amp; Voice) with the same subject token, so customers just hit Reply.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Support address" hint="Customers write here. Used as the From/Reply-To on replies."><Input type="email" value={s.mailbox.address} onChange={(e) => setMailbox({ address: e.target.value })} placeholder="support@yourco.com" /></Field>
          <Field label="Display name"><Input value={s.mailbox.displayName} onChange={(e) => setMailbox({ displayName: e.target.value })} /></Field>
        </div>

        <div className="rounded-lg border p-3">
          <p className="mb-2 text-xs font-medium">Option A — Pull via IMAP (Gmail, Outlook, Zoho, any IMAP host)</p>
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="IMAP host"><Input value={s.mailbox.imapHost} onChange={(e) => setMailbox({ imapHost: e.target.value })} placeholder="imap.gmail.com" /></Field>
            <Field label="Port"><Input type="number" value={s.mailbox.imapPort} onChange={(e) => setMailbox({ imapPort: Number(e.target.value) || 993 })} /></Field>
            <Field label="Username"><Input value={s.mailbox.imapUser} onChange={(e) => setMailbox({ imapUser: e.target.value })} /></Field>
            <Field label="Password / app password" hint={s.hasImapPassword ? 'Stored encrypted. Leave blank to keep it.' : 'Stored encrypted, never shown again.'}>
              <Input type="password" autoComplete="new-password" value={imapPassword} onChange={(e) => setImapPassword(e.target.value)} placeholder={s.hasImapPassword ? '••••••••' : ''} />
            </Field>
            <Field label="Folder"><Input value={s.mailbox.folder} onChange={(e) => setMailbox({ folder: e.target.value })} /></Field>
            <label className="flex items-end gap-2 pb-2 text-xs text-muted-foreground"><Switch checked={s.mailbox.imapSecure} onCheckedChange={(v) => setMailbox({ imapSecure: v })} /> TLS</label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button size="sm" variant="outline" onClick={poll} disabled={polling || !s.mailbox.enabled} className="gap-1.5">
              {polling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Check mailbox now
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Save first. The scheduler (<code>POST /api/borga/cron</code>, every 5 min) polls automatically.
              {s.mailbox.lastPolledAt && ` Last checked ${new Date(s.mailbox.lastPolledAt).toLocaleString()}.`}
            </p>
          </div>
          {s.mailbox.lastError && <p className="mt-2 text-xs text-rose-600">Last error: {s.mailbox.lastError}</p>}
        </div>

        <div className="rounded-lg border p-3">
          <p className="mb-2 text-xs font-medium">Option B — Push via webhook (Cloudflare Email Routing, Postmark, Mailgun)</p>
          <Field label="Inbound URL" hint="POST JSON or form data. Send the token below as 'Authorization: Bearer …'. See docs/TICKETING.md for ready-made Worker code.">
            <div className="flex gap-2">
              <Input readOnly value={s.inboundUrl} className="font-mono text-xs" />
              <Button size="icon" variant="outline" onClick={() => copy(s.inboundUrl)}><Copy className="h-4 w-4" /></Button>
            </div>
          </Field>
          <Field label="Inbound token" className="mt-3">
            <div className="flex gap-2">
              <Input readOnly type="password" value={s.inboundToken} className="font-mono text-xs" />
              <Button size="icon" variant="outline" onClick={() => copy(s.inboundToken)}><Copy className="h-4 w-4" /></Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => save({ regenerateToken: true })}><KeyRound className="h-3.5 w-3.5" /> Regenerate</Button>
            </div>
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <Switch checked={s.mailbox.autoAck} onCheckedChange={(v) => setMailbox({ autoAck: v })} /> Automatically acknowledge new email tickets with the ticket number
        </label>
      </Card>
    </div>
  );
}
