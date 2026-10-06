'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, FlaskConical, Loader2, KeyRound } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';
import { WEBHOOK_EVENTS, type Webhook } from '@/lib/borga/data';
import { SectionTitle } from './bits';
import { Field } from './form-widgets';
import { SearchSelect } from './SearchSelect';
import { ConfirmDialog } from './ConfirmDialog';
import { cn } from '@/lib/utils';

const EVENT_LABELS: Record<string, string> = {
  'booking.created': 'Booking created',
  'booking.updated': 'Booking updated',
  'booking.delivered': 'Booking delivered',
  'driver.onboarded': 'Driver onboarded',
  'client.created': 'Client created',
  'sla.breached': 'SLA breached',
  'tracking.updated': 'Tracking updated',
  'payment.received': 'Payment received',
};

interface DeliveryRow {
  webhookId: string;
  eventId: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  lastAttempt: string;
  error?: string;
  responseStatus?: number;
}

function validEndpoint(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return 'That is not a valid URL.';
  }
  if (parsed.protocol !== 'https:') return 'Webhook URL must use HTTPS.';
  const host = parsed.hostname.toLowerCase();
  const internal =
    host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' ||
    host.startsWith('192.168.') || host.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.startsWith('169.254.') || host.endsWith('.local');
  if (internal) return 'Webhook URL must not target internal addresses.';
  return null;
}

/**
 * Full webhook management bound to the shared `webhooks` store slice:
 * create (with a real server-side signing secret), enable/disable, test,
 * delivery history, and delete. The secret itself is encrypted server-side and
 * can never be read back — the list only shows whether one is set.
 */
export function WebhookManager({ compact = false }: { compact?: boolean }) {
  const { webhooks, addWebhook, toggleWebhook, deleteWebhook, activeWorkspaceId: ws, log } = useBorga();
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ name: '', event: WEBHOOK_EVENTS[0] as string, url: '', secret: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Webhook | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [secretOf, setSecretOf] = useState<Record<string, boolean>>({});
  const [queue, setQueue] = useState<{ pending: number; failed: number; delivered: number } | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const secretState = useCallback(async (id: string) => {
    const r = await fetch('/api/borga/webhooks/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
      body: JSON.stringify({ ws, action: 'secretState', webhookId: id }),
    });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; hasSecret?: boolean } | null;
    if (j?.ok) setSecretOf((s) => ({ ...s, [id]: !!j.hasSecret }));
  }, [ws]);

  const refreshMeta = useCallback(async () => {
    const r = await fetch('/api/borga/webhooks/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
      body: JSON.stringify({ ws, action: 'deliveries' }),
    });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; deliveries?: DeliveryRow[] } | null;
    if (j?.ok && j.deliveries) {
      setDeliveries(j.deliveries);
      const n = (s: DeliveryRow['status']) => j.deliveries!.filter((d) => d.status === s).length;
      setQueue({ pending: n('pending'), failed: n('failed'), delivered: n('delivered') });
    }
    webhooks.forEach((w) => void secretState(w.id));
  }, [ws, webhooks, secretState]);

  useEffect(() => {
    void refreshMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws]);

  const save = async () => {
    if (!form.name.trim() || !form.url.trim()) return;
    const problem = validEndpoint(form.url);
    if (problem) {
      setFormError(problem);
      return;
    }
    setSaving(true);
    const w: Webhook = {
      id: `wh-${Date.now().toString(36)}`,
      name: form.name.trim(),
      event: form.event,
      url: form.url.trim(),
      secret: '',
      active: true,
      lastDelivery: '…',
      deliveries: 0,
    };
    addWebhook(w);
    if (form.secret.trim()) {
      const r = await fetch('/api/borga/webhooks/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ ws, action: 'saveSecret', webhookId: w.id, secret: form.secret.trim() }),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!j?.ok) toast({ title: 'Webhook saved, secret not stored', description: j?.error ?? 'Set it again from the list.', variant: 'warning' });
    }
    log({ agentId: 'a-integrations', agentName: 'Iris', actor: 'user', kind: 'sync', message: `Webhook configured: ${w.name} → ${w.event}.` });
    setForm({ name: '', event: WEBHOOK_EVENTS[0] as string, url: '', secret: '' });
    setFormError(null);
    setSaving(false);
    setFormOpen(false);
    void secretState(w.id);
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    await fetch('/api/borga/webhooks/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
      body: JSON.stringify({ ws, action: 'deleteSecret', webhookId: confirmDelete.id }),
    }).catch(() => null);
    deleteWebhook(confirmDelete.id);
    log({ agentId: 'a-integrations', agentName: 'Iris', actor: 'user', kind: 'sync', message: `Webhook "${confirmDelete.name}" deleted.` });
    setConfirmDelete(null);
  };

  const test = async (w: Webhook) => {
    setTestingId(w.id);
    const r = await fetch('/api/borga/webhooks/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
      body: JSON.stringify({
        ws,
        action: 'dispatch',
        webhookId: w.id,
        eventId: 'webhook.test',
        payload: { test: true, timestamp: new Date().toISOString(), message: 'Test webhook delivery' },
      }),
    });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; status?: string; error?: string } | null;
    setTestingId(null);
    if (j?.ok && j.status === 'delivered') toast({ title: 'Test delivered', description: `${w.name} answered 2xx.`, variant: 'success' });
    else toast({ title: 'Test not delivered', description: j?.error ?? 'Queued — check the endpoint and try again.', variant: 'warning' });
    void refreshMeta();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {!compact && <SectionTitle title="Webhooks" sub="Send engine events to your HTTPS endpoints — signed when you set a secret" />}
        <div className="flex items-center gap-2">
          {queue && (
            <span className="text-[11px] text-muted-foreground">
              {queue.delivered} delivered · {queue.pending} pending · {queue.failed} failed
            </span>
          )}
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setShowHistory((v) => !v)}>
            History
          </Button>
          <Button size="sm" onClick={() => setFormOpen(true)} className="gap-1"><Plus className="h-3.5 w-3.5" /> Add webhook</Button>
        </div>
      </div>

      {webhooks.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No webhooks yet. Add one to start receiving engine events at your own endpoint.
        </Card>
      )}

      <div className="space-y-2">
        {webhooks.map((w) => (
          <Card key={w.id} className="flex flex-wrap items-center gap-3 p-3.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{w.name}</p>
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary ring-1 ring-primary/30">{EVENT_LABELS[w.event] ?? w.event}</span>
                {!w.active && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">paused</span>}
              </div>
              <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{w.url}</p>
              <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                <KeyRound className="h-3 w-3" /> signing secret {secretOf[w.id] ? 'set' : 'not set'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button size="sm" variant="outline" className="h-8 gap-1" disabled={testingId === w.id} onClick={() => test(w)}>
                {testingId === w.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />} Test
              </Button>
              <Switch checked={w.active} onCheckedChange={() => toggleWebhook(w.id)} />
              <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setConfirmDelete(w)} title="Delete webhook">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {showHistory && (
        <Card className="overflow-hidden">
          <p className="border-b px-4 py-2.5 text-sm font-medium">Recent deliveries <span className="font-normal text-muted-foreground">(last 30)</span></p>
          {deliveries.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">Nothing delivered yet.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <tbody>
                  {deliveries.map((d, n) => (
                    <tr key={`${d.webhookId}-${d.eventId}-${n}`} className="border-b last:border-0">
                      <td className="px-4 py-2 font-mono text-[11px]">{d.eventId}</td>
                      <td className="px-2 py-2">
                        <span className={cn(
                          'rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1',
                          d.status === 'delivered' ? 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30'
                          : d.status === 'failed' ? 'bg-rose-500/10 text-rose-600 ring-rose-500/30'
                          : 'bg-amber-500/10 text-amber-600 ring-amber-500/30',
                        )}>{d.status}</span>
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">{d.attempts}×{d.responseStatus ? ` · HTTP ${d.responseStatus}` : ''}{d.error ? ` · ${d.error}` : ''}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right text-muted-foreground">{new Date(d.lastAttempt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Dialog open={formOpen} onOpenChange={(o) => { setFormOpen(o); if (!o) setFormError(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Configure a webhook</DialogTitle>
            <DialogDescription>HTTPS endpoints only. A signing secret lets your server verify every delivery.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Name">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Ops → CRM" autoFocus />
            </Field>
            <Field label="Event">
              <SearchSelect
                options={WEBHOOK_EVENTS.map((ev) => ({ value: ev, label: EVENT_LABELS[ev] ?? ev, detail: ev }))}
                value={form.event}
                onChange={(v) => setForm({ ...form, event: v || WEBHOOK_EVENTS[0] })}
                placeholder="Event"
                searchPlaceholder="Search events"
                clearable={false}
              />
            </Field>
            <Field label="Endpoint URL">
              <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://your-app.com/hooks/borga" className="font-mono text-xs" />
            </Field>
            <Field label="Signing secret (optional)" hint="Stored encrypted server-side, never shown again">
              <Input value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} placeholder="Shared secret for HMAC verification" />
            </Field>
            {formError && <p className="text-xs text-destructive">{formError}</p>}
            <Button className="w-full gap-1.5" onClick={save} disabled={saving || !form.name.trim() || !form.url.trim()}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}<Plus className="h-4 w-4" /> Save webhook
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}
        title={`Delete webhook "${confirmDelete?.name ?? ''}"?`}
        description="The endpoint, its signing secret and its queued deliveries stop here. External senders will get errors."
        confirmLabel="Delete webhook"
        onConfirm={doDelete}
      />
    </div>
  );
}
