'use client';

import { useCallback, useEffect, useState } from 'react';
import { Flame, ExternalLink, Loader2, RefreshCw, Settings2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';
import { useFeature } from '@/lib/borga/features-client';
import { EXPLEE_SIGNUP_URL } from '@/lib/borga/providers';
import { configTargetForProvider, openConfigDeepLink } from '@/lib/borga/config-deeplink';

interface SyncJobState {
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  failures: number;
  nextRunAt: string | null;
  runningSince: string | null;
}

interface Answer {
  ok: boolean;
  jobs?: Array<{ id: string; feature: string; everyMs: number; state: SyncJobState }>;
  explee?: { configured: boolean; source: 'workspace' | 'platform' | null };
}

const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');

/**
 * The Explee strip on the sales pipeline: at one glance, whether hot leads are
 * flowing in, when the next check is, and a Sync-now button (which also refreshes
 * the dashboard the moment leads land). Not connected? The strip becomes the
 * pitch: the sign-up link plus a deep link to the Connections card.
 */
export function ExpleeSyncCard() {
  const on = useFeature('explee');
  const ws = useBorga((s) => s.activeWorkspaceId);
  const hydrate = useBorga((s) => s.hydrate);
  const [data, setData] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!ws) return;
    try {
      const res = await fetch(`/api/borga/sync?ws=${encodeURIComponent(ws)}`, { cache: 'no-store' });
      const j = (await res.json()) as Answer;
      if (j.ok) setData(j);
    } catch {
      /* the strip stays quiet when the server can't be reached */
    }
  }, [ws]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!on) return null;

  const job = data?.jobs?.find((j) => j.id === 'explee-hot-leads');
  const connected = data?.explee?.configured ?? false;

  const syncNow = async () => {
    if (!ws || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/borga/sync?ws=${encodeURIComponent(ws)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: 'explee-hot-leads' }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; result?: { added?: number } };
      if (!j.ok) {
        toast({ title: 'Sync failed', description: j.error, variant: 'error' });
      } else {
        const added = j.result?.added ?? 0;
        if (added > 0) {
          toast({
            title: added === 1 ? 'New hot lead from Explee' : `${added} new hot leads from Explee`,
            description: 'They are now in your sales pipeline.',
            variant: 'success',
          });
          void hydrate();
        } else {
          toast({ title: 'Checked Explee', description: 'No new hot leads since the last check.', variant: 'success' });
        }
      }
    } catch {
      toast({ title: 'Sync failed', description: 'Could not reach the server.', variant: 'error' });
    }
    setBusy(false);
    void load();
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <Flame className="h-4 w-4 shrink-0 text-amber-500" />
        {!data ? (
          <span className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Explee hot-lead sync…</span>
        ) : connected ? (
          <>
            <span className="shrink-0 text-sm font-medium">Explee hot-lead sync</span>
            <span className="truncate text-muted-foreground">
              {job?.state.lastOkAt ? `checked ${fmtTime(job.state.lastOkAt)}` : 'waiting for its first check'}
              {job?.state.nextRunAt ? ` · next around ${fmtTime(job.state.nextRunAt)}` : ''}
            </span>
            {job?.state.lastError && (
              <span className="flex min-w-0 items-center gap-1 truncate text-rose-600" title={job.state.lastError}>
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {job.state.lastError}
              </span>
            )}
          </>
        ) : (
          <>
            <span className="shrink-0 text-sm font-medium">Explee</span>
            <span className="truncate text-muted-foreground">finds B2B leads, emails them, and the ones who reply with real interest land here automatically — about every 10 minutes.</span>
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {data && connected ? (
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={syncNow} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Sync now
          </Button>
        ) : (
          <>
            <a
              href={EXPLEE_SIGNUP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              Create an Explee account <ExternalLink className="h-3 w-3" />
            </a>
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => openConfigDeepLink(configTargetForProvider('explee'))}>
              <Settings2 className="h-3.5 w-3.5" /> Set up in Connections
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
