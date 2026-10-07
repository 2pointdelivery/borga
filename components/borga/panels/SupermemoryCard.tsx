'use client';

import { ConnectionSummary } from './ConnectionSummary';
import { useCallback, useEffect, useState } from 'react';
import { Brain, Loader2, RefreshCw, Trash2, Eye } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useFeatures } from '@/lib/borga/features-client';
import { Badge } from '@/components/ui/badge';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';
import { ConfirmDialog } from '../ConfirmDialog';

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
  const [confirmPurge, setConfirmPurge] = useState(false);
  const toggleFeature = useFeatures((f) => f.toggle);
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
    try {
      const r = await post({ action: 'saveSettings', settings: { [key]: v } });
      if (!r.ok) toast({ title: 'Not saved', description: r.error, variant: 'error' });
    } catch (error) {
      toast({ title: 'Not saved', description: error instanceof Error ? error.message : 'Network error — try again.', variant: 'error' });
    }
    void load();
  };

  const run = async (name: 'syncNow' | 'profile' | 'purge') => {
    if (name === 'purge') {
      setConfirmPurge(true);
      return;
    }
    setBusy(name);
    try {
      const r = await post({ action: name });
      if (!r.ok) return toast({ title: 'Supermemory', description: r.error ?? 'Request failed', variant: 'error' });
      if (name === 'profile') setFacts((r.facts as string[]) ?? []);
      if (name === 'syncNow') toast({ title: 'Sync finished', variant: 'success' });
      void load();
    } catch (error) {
      toast({ title: 'Supermemory', description: error instanceof Error ? error.message : 'Network error — try again.', variant: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const doPurge = async () => {
    setConfirmPurge(false);
    setBusy('purge');
    try {
      const r = await post({ action: 'purge', confirm: 'DELETE' });
      if (!r.ok) return toast({ title: 'Supermemory', description: r.error ?? 'Request failed', variant: 'error' });
      toast({ title: 'Deleted from Supermemory', description: `${(r.deletedDocuments as number | undefined) ?? 0} document(s) removed.`, variant: 'success' });
      void load();
    } catch (error) {
      toast({ title: 'Supermemory', description: error instanceof Error ? error.message : 'Network error — try again.', variant: 'error' });
    } finally {
      setBusy(null);
    }
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

      <ConnectionSummary providerId="supermemory" hint={s.keySource === 'deployment' ? 'Using the deployment key. Add your own in Connections to use it instead.' : undefined} />

      {!s.featureOn && (
        <p className="text-xs text-muted-foreground">
          Off by default because it sends data to Supermemory, a third party. {s.featureLocked ? 'The deployment has it disabled (BORGA_FEATURES_OFF).' : 'Add a key, then switch it on above.'}
        </p>
      )}
      {s.featureOn && s.keySource === 'none' && <p className="text-xs text-amber-600">Switched on, but there is no API key yet. Add one in Connections (or set SUPERMEMORY_API_KEY on the server).</p>}
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

      <ConfirmDialog
        open={confirmPurge}
        onOpenChange={setConfirmPurge}
        title="Delete everything from Supermemory?"
        description="All vectors stored for this company are removed. Your Borga data is not affected, and it can be sent again by syncing."
        confirmLabel="Delete from Supermemory"
        onConfirm={doPurge}
      />
    </Card>
  );
}
