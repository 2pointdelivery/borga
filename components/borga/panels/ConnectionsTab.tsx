'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, Copy, ExternalLink, Trash2, Save, PlugZap } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';
import type { ProviderDef, ProviderId } from '@/lib/borga/providers';
import { SectionTitle } from '../bits';
import { Field } from '../form-widgets';
import { ConfirmDialog } from '../ConfirmDialog';

interface Status {
  provider: ProviderId;
  configured: boolean;
  fields: Array<{ key: string; display: string; set: boolean }>;
  updatedAt: string | null;
  verifyToken: string | null;
  lastTest: { ok: boolean; message: string; details?: string[]; at: string } | null;
}

interface Payload {
  providers: ProviderDef[];
  statuses: Status[];
  webhookUrls: Record<'meta' | 'twilio', string>;
}

const HEADERS = { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' };

function copy(text: string) {
  void navigator.clipboard?.writeText(text).then(() => toast({ title: 'Copied', variant: 'success' }));
}

function ProviderCard({ def, status, webhookUrl, ws, onChange }: { def: ProviderDef; status: Status; webhookUrl?: string; ws: string; onChange: () => void }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'save' | 'test' | 'delete' | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const url = `/api/borga/connections?ws=${encodeURIComponent(ws)}`;
  const call = async (body: Record<string, unknown>) => {
    const res = await fetch(url, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
    return (await res.json().catch(() => ({ ok: false, error: 'Bad response' }))) as { ok: boolean; error?: string; result?: Status['lastTest'] };
  };

  const dirty = Object.values(draft).some((v) => v.trim() !== '');

  const save = async () => {
    setBusy('save');
    const r = await call({ action: 'save', provider: def.id, values: draft });
    setBusy(null);
    if (!r.ok) return toast({ title: 'Not saved', description: r.error, variant: 'error' });
    setDraft({});
    toast({ title: `${def.label} saved`, variant: 'success' });
    onChange();
  };
  const test = async () => {
    setBusy('test');
    const r = await call({ action: 'test', provider: def.id });
    setBusy(null);
    if (r.result) toast({ title: r.result.ok ? 'Connection works' : 'Connection failed', description: r.result.message, variant: r.result.ok ? 'success' : 'error' });
    onChange();
  };
  const remove = async () => {
    setBusy('delete');
    await call({ action: 'delete', provider: def.id });
    setBusy(null);
    onChange();
  };

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <PlugZap className="h-4 w-4 text-primary" /> {def.label}
            {status.configured ? <Badge variant="secondary">Saved</Badge> : <Badge variant="outline">Not configured</Badge>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{def.description}</p>
        </div>
        {def.docsUrl && (
          <a href={def.docsUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline">
            Docs <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">How to get these</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">{def.steps.map((s) => <li key={s}>{s}</li>)}</ol>
      </details>

      <div className="grid gap-3 md:grid-cols-2">
        {def.fields.map((f) => {
          const st = status.fields.find((x) => x.key === f.key);
          return (
            <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} hint={f.hint}>
              <Input
                type={f.secret ? 'password' : 'text'}
                autoComplete="off"
                value={draft[f.key] ?? ''}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                placeholder={st?.set ? (f.secret ? `${st.display} (saved; type to replace)` : `${st.display} (saved)`) : f.placeholder ?? ''}
              />
            </Field>
          );
        })}
      </div>

      {def.webhook && status.configured && webhookUrl && (
        <div className="rounded-lg border p-3 text-xs">
          <p className="mb-1 font-medium">Webhook (paste into {def.id === 'meta' ? 'Meta → WhatsApp → Configuration' : 'Twilio → phone number → Voice & Messaging'})</p>
          <div className="flex gap-2">
            <Input readOnly value={webhookUrl} className="font-mono text-xs" />
            <Button size="icon" variant="outline" onClick={() => copy(webhookUrl)}><Copy className="h-4 w-4" /></Button>
          </div>
          {def.id === 'meta' && status.verifyToken && (
            <div className="mt-2 flex items-center gap-2">
              <span className="shrink-0 text-muted-foreground">Verify token</span>
              <Input readOnly value={status.verifyToken} className="font-mono text-xs" />
              <Button size="icon" variant="outline" onClick={() => copy(status.verifyToken ?? '')}><Copy className="h-4 w-4" /></Button>
            </div>
          )}
          <p className="mt-2 text-muted-foreground">Needs a public HTTPS address. See docs/HOSTING.md.</p>
        </div>
      )}

      {status.lastTest && (
        <div className={`flex gap-2 rounded-lg border p-3 text-xs ${status.lastTest.ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/5'}`}>
          {status.lastTest.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="h-4 w-4 shrink-0 text-rose-600" />}
          <div>
            <p className="font-medium">{status.lastTest.message}</p>
            {status.lastTest.details?.map((d) => <p key={d} className="text-muted-foreground">{d}</p>)}
            <p className="text-muted-foreground">Checked {new Date(status.lastTest.at).toLocaleString()}</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={save} disabled={!dirty || busy !== null} className="gap-1.5">
          {busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
        </Button>
        <Button size="sm" variant="outline" onClick={test} disabled={!status.configured || busy !== null} className="gap-1.5" title={def.testable ? '' : 'No live check available yet'}>
          {busy === 'test' && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Test connection
        </Button>
        {status.configured && (
          <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(true)} disabled={busy !== null} className="gap-1.5 text-rose-600">
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Remove the saved ${def.label} credentials?`}
        description="Integrations using them stop working until you save new ones."
        confirmLabel="Remove credentials"
        onConfirm={() => { setConfirmRemove(false); void remove(); }}
      />
    </Card>
  );
}

export function ConnectionsTab() {
  const { activeWorkspaceId: ws } = useBorga();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/borga/connections?ws=${encodeURIComponent(ws)}`, { cache: 'no-store' });
      const j = (await res.json()) as Payload & { ok: boolean; error?: string };
      if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setData(j);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [ws]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <Card className="p-6 text-sm text-muted-foreground">Could not load connections: {error}</Card>;
  if (!data) return <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-5">
      <SectionTitle title="Connections" sub="Bring your own credentials. They are encrypted, scoped to this company, and never shown again after saving." />
      {data.providers.map((def) => {
        const status = data.statuses.find((s) => s.provider === def.id);
        return status ? (
          <ProviderCard key={def.id} def={def} status={status} ws={ws} onChange={load} webhookUrl={def.webhook ? data.webhookUrls[def.webhook] : undefined} />
        ) : null;
      })}
    </div>
  );
}

/** One provider's connection card, for embedding where the feature lives (e.g. Company Engine). */
export function ConnectionPanel({ providerId, onChange }: { providerId: ProviderId; onChange?: () => void }) {
  const { activeWorkspaceId: ws } = useBorga();
  const [data, setData] = useState<Payload | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/borga/connections?ws=' + encodeURIComponent(ws), { cache: 'no-store' });
      const j = (await res.json()) as Payload & { ok: boolean };
      if (j.ok) setData(j);
    } catch {
      /* card stays empty */
    }
  }, [ws]);
  useEffect(() => {
    void load();
  }, [load]);
  const def = data?.providers.find((p) => p.id === providerId);
  const status = data?.statuses.find((s) => s.provider === providerId);
  if (!data || !def || !status) return <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  return (
    <ProviderCard
      def={def}
      status={status}
      ws={ws}
      webhookUrl={def.webhook ? data.webhookUrls[def.webhook] : undefined}
      onChange={() => {
        void load();
        onChange?.();
      }}
    />
  );
}
