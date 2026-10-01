'use client';

import { useCallback, useEffect, useState } from 'react';
import { Brain, Loader2, RefreshCw, Trash2, Eye, KeyRound, CheckCircle2, XCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { useFeatures } from '@/lib/borga/features-client';
import { Badge } from '@/components/ui/badge';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';

interface State {
  featureOn: boolean;
  featureLocked: boolean;
  keySource: 'workspace' | 'deployment' | 'none';
  settings: { memory: boolean; knowledge: boolean; tickets: boolean; profile: boolean };
  connection: { configured: boolean; display: string; lastTest: { ok: boolean; message: string; at: string } | null } | null;
  status: { kb: { lastSyncAt: string | null; indexed: number; lastError: string | null }; tickets: { lastSyncAt: string | null; indexed: number }; outbox: number };
}

const HEADERS = { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' };

const SOURCES: Array<{ key: keyof State['settings']; label: string; sends: string }> = [
  { key: 'memory', label: 'Agent memory', sends: 'Sends each memory your agents store, and searches them before runs.' },
  { key: 'knowledge', label: 'Knowledge base', sends: 'Sends every knowledge-base entry (title + answer) so agents and chat retrieve only the relevant ones.' },
  { key: 'tickets', label: 'Resolved support tickets', sends: 'Sends resolved tickets (subject, problem, resolution thread). Email addresses are redacted; requester names are not sent.' },
  { key: 'profile', label: 'Company profile', sends: 'Reads back standing facts that Supermemory derived from the data above. Sends nothing extra.' },
];

/** Controls for the optional Supermemory memory layer: what may leave the system, sync, preview and erase. */
export function SupermemoryCard() {
  const { activeWorkspaceId: ws } = useBorga();
  const [s, setS] = useState<State | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [facts, setFacts] = useState<string[] | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const toggleFeature = useFeatures((f) => f.toggle);
  const connUrl = `/api/borga/connections?ws=${encodeURIComponent(ws)}`;
  const url = `/api/borga/supermemory?ws=${encodeURIComponent(ws)}`;

  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      const j = (await r.json()) as State & { ok: boolean };
      if (j.ok) setS(j);
    } catch {
      /* card stays hidden */
    }
  }, [url]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async (b: Record<string, unknown>) => (await fetch(url, { method: 'POST', headers: HEADERS, body: JSON.stringify(b) })).json() as Promise<Record<string, unknown> & { ok: boolean; error?: string }>;

  if (!s) return null;

  const toggle = async (key: keyof State['settings'], v: boolean) => {
    setS({ ...s, settings: { ...s.settings, [key]: v } });
    const r = await post({ action: 'saveSettings', settings: { [key]: v } });
    if (!r.ok) toast({ title: 'Not saved', description: r.error, variant: 'error' });
    void load();
  };

  const run = async (name: 'syncNow' | 'profile' | 'purge') => {
    if (name === 'purge' && !window.confirm('Delete everything Borga stored in Supermemory for this company? Your Borga data is not affected, and it can be sent again by syncing.')) return;
    setBusy(name);
    const r = await post(name === 'purge' ? { action: 'purge', confirm: 'DELETE' } : { action: name });
    setBusy(null);
    if (!r.ok) return toast({ title: 'Supermemory', description: r.error ?? 'Request failed', variant: 'error' });
    if (name === 'profile') setFacts((r.facts as string[]) ?? []);
    if (name === 'syncNow') toast({ title: 'Sync finished', variant: 'success' });
    if (name === 'purge') toast({ title: 'Deleted from Supermemory', description: `${(r.deletedDocuments as number | undefined) ?? 0} document(s) removed.`, variant: 'success' });
    void load();
  };

  const live = s.featureOn && s.keySource !== 'none';

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Brain className="h-4 w-4 text-primary" /> Long-term AI memory (Supermemory)
          <Badge variant={live ? 'secondary' : 'outline'}>{live ? 'On' : 'Off'}</Badge>
        </div>
        {live && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => run('syncNow')} disabled={busy !== null}>
              {busy === 'syncNow' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Sync now
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => run('profile')} disabled={busy !== null}><Eye className="h-3.5 w-3.5" /> What it knows</Button>
          </div>
        )}
      </div>

      <label className="flex items-start justify-between gap-4 rounded-lg border px-3 py-2.5">
        <span>
          <span className="block text-sm font-medium">Use Supermemory for this company</span>
          <span className="block text-xs text-muted-foreground">Master switch (also under Settings → Features). While off, nothing is sent and agents behave exactly as before.</span>
        </span>
        <Switch
          checked={s.featureOn}
          disabled={s.featureLocked}
          onCheckedChange={async (v) => {
            setS({ ...s, featureOn: v });
            const err = await toggleFeature('supermemory', v);
            if (err) toast({ title: 'Could not change the setting', description: err, variant: 'error' });
            void load();
          }}
        />
      </label>

      <div className="space-y-2 rounded-lg border px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm font-medium"><KeyRound className="h-3.5 w-3.5 text-primary" /> API key
            {s.connection?.configured && <Badge variant="secondary" className="font-mono text-[10px]">{s.connection.display}</Badge>}
            {!s.connection?.configured && s.keySource === 'deployment' && <Badge variant="outline" className="text-[10px]">using the deployment key</Badge>}
          </p>
          <a href="https://console.supermemory.ai/keys" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">Get a key</a>
        </div>
        <div className="flex gap-2">
          <Input type="password" autoComplete="off" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} placeholder={s.connection?.configured ? 'Paste a new key to replace it' : 'sm_…'} className="h-8 font-mono text-xs" />
          <Button
            size="sm"
            disabled={!keyDraft.trim() || busy !== null}
            onClick={async () => {
              setBusy('key');
              const res = await fetch(connUrl, { method: 'POST', headers: HEADERS, body: JSON.stringify({ action: 'save', provider: 'supermemory', values: { apiKey: keyDraft.trim() } }) });
              const j = (await res.json()) as { ok: boolean; error?: string };
              setBusy(null);
              if (!j.ok) return toast({ title: 'Key not saved', description: j.error, variant: 'error' });
              setKeyDraft('');
              toast({ title: 'Key saved (encrypted)', variant: 'success' });
              void load();
            }}
          >
            Save key
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!s.connection?.configured || busy !== null}
            onClick={async () => {
              setBusy('test');
              await fetch(connUrl, { method: 'POST', headers: HEADERS, body: JSON.stringify({ action: 'test', provider: 'supermemory' }) });
              setBusy(null);
              void load();
            }}
          >
            {busy === 'test' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Test'}
          </Button>
          {s.connection?.configured && (
            <Button
              size="sm"
              variant="ghost"
              className="text-rose-600"
              disabled={busy !== null}
              onClick={async () => {
                if (!window.confirm('Remove the saved Supermemory key for this company?')) return;
                await fetch(connUrl, { method: 'POST', headers: HEADERS, body: JSON.stringify({ action: 'delete', provider: 'supermemory' }) });
                void load();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        {s.connection?.lastTest && (
          <p className={'flex items-center gap-1.5 text-xs ' + (s.connection.lastTest.ok ? 'text-emerald-600' : 'text-rose-600')}>
            {s.connection.lastTest.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />} {s.connection.lastTest.message}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground">Stored encrypted for this company only. Operators can instead set <code>SUPERMEMORY_API_KEY</code> on the server for all companies.</p>
      </div>

      {!s.featureOn && (
        <p className="text-xs text-muted-foreground">
          Off by default because it sends data to Supermemory, a third party. {s.featureLocked ? 'The deployment has it disabled (BORGA_FEATURES_OFF).' : 'Add a key, then switch it on above.'}
        </p>
      )}
      {s.featureOn && s.keySource === 'none' && <p className="text-xs text-amber-600">Switched on, but there is no API key yet. Paste one above (or set SUPERMEMORY_API_KEY on the server).</p>}
      {live && <p className="text-xs text-muted-foreground">Key source: {s.keySource === 'workspace' ? 'this company’s own key' : 'the deployment key'}. Data is isolated to this company.</p>}

      <div className="divide-y rounded-lg border">
        {SOURCES.map((src) => (
          <label key={src.key} className="flex items-start justify-between gap-4 px-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-sm font-medium">{src.label}</span>
              <span className="block text-xs text-muted-foreground">{src.sends}</span>
            </span>
            <Switch checked={s.settings[src.key]} onCheckedChange={(v) => toggle(src.key, v)} />
          </label>
        ))}
      </div>

      {live && (
        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
          <p>Knowledge base: <strong className="text-foreground">{s.status.kb.indexed}</strong> indexed{s.status.kb.lastSyncAt ? `, synced ${new Date(s.status.kb.lastSyncAt).toLocaleString()}` : ', not synced yet'}.</p>
          <p>Tickets: <strong className="text-foreground">{s.status.tickets.indexed}</strong> indexed.</p>
          <p>Waiting to retry: <strong className="text-foreground">{s.status.outbox}</strong>.</p>
          {s.status.kb.lastError && <p className="text-rose-600 sm:col-span-3">{s.status.kb.lastError}</p>}
        </div>
      )}

      {facts && (
        <div className="rounded-lg border bg-muted/20 p-3 text-xs">
          <p className="mb-1 font-medium">Standing facts Supermemory holds about this company</p>
          {facts.length ? <ul className="list-disc space-y-0.5 pl-5">{facts.map((f) => <li key={f}>{f}</li>)}</ul> : <p className="text-muted-foreground">Nothing yet. Facts appear after it has processed your memories and documents.</p>}
        </div>
      )}

      {live && (
        <Button size="sm" variant="ghost" className="gap-1.5 text-rose-600" onClick={() => run('purge')} disabled={busy !== null}>
          <Trash2 className="h-3.5 w-3.5" /> Delete everything from Supermemory
        </Button>
      )}
    </Card>
  );
}
