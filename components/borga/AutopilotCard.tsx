'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useBorga } from '@/lib/borga/store';

const HEADERS = { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' };

interface AutopilotApi {
  enabled: boolean;
  running: boolean;
  intervalMs: number;
  startedAt: string | null;
  ticking: boolean;
  lastTick: {
    startedAt: string;
    durationMs: number;
    workspaces: number;
    candidates?: number;
    truncated?: number;
    ticked: string[];
    skipped: unknown[];
    errors: unknown[];
  } | null;
  cronConfigured: boolean;
  deferredToCron: boolean;
  disabledByEnv: boolean;
}

interface WorkspaceState {
  paused: boolean;
  autonomousMode: boolean;
  quietHours: { start: string; end: string } | null;
  heartbeatFeature: boolean;
}

/**
 * The always-on autopilot is the server's own beat: it runs whether or not a
 * dashboard tab is open. This card reports the loop the server actually runs
 * and flips the durable pause switch — nothing here is a client-side timer.
 */
export function AutopilotCard() {
  const { activeWorkspaceId } = useBorga();
  const [status, setStatus] = useState<AutopilotApi | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/borga/autopilot?ws=${encodeURIComponent(activeWorkspaceId)}`, { headers: HEADERS });
      const d = (await r.json()) as { ok?: boolean; autopilot?: AutopilotApi; workspace?: WorkspaceState; error?: string };
      if (!d.ok) return;
      if (d.autopilot) setStatus(d.autopilot);
      if (d.workspace) setWorkspace(d.workspace);
    } catch {
      // A status read is best-effort; the next poll retries.
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (action: 'pause' | 'resume' | 'tick') => {
    if (busy) return;
    setBusy(true);
    setMsg('');
    try {
      const r = await fetch('/api/borga/autopilot', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ action, ws: activeWorkspaceId }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string; tick?: { ticked: string[]; skipped: unknown[] } };
      if (!d.ok) {
        setMsg(d.error ?? 'Could not reach the autopilot.');
        return;
      }
      setMsg(action === 'tick' ? `Beat ran — ${d.tick?.ticked.length ?? 0} workspace(s) ticked.` : action === 'pause' ? 'Autopilot paused for this company.' : 'Autopilot resumed.');
      await load();
    } catch {
      setMsg('Could not reach the autopilot.');
    } finally {
      setBusy(false);
    }
  };

  const paused = workspace?.paused ?? false;
  const live = !!status?.running && !paused;
  const last = status?.lastTick;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Activity className={cn('mt-0.5 h-4 w-4', live ? 'text-emerald-500' : 'text-muted-foreground')} />
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold">
              Autopilot
              <Badge variant="outline" className={cn('gap-1.5', live && 'text-emerald-600')}>
                <span className={cn('h-2 w-2 rounded-full', live ? 'bg-emerald-500' : 'bg-muted-foreground/50')} />
                {status?.disabledByEnv
                  ? 'off (server)'
                  : status?.deferredToCron
                    ? 'external cron'
                    : paused
                      ? 'paused'
                      : status?.running
                        ? 'running'
                        : 'not running'}
              </Badge>
            </p>
            <p className="mt-1 max-w-xl text-xs text-muted-foreground">
              The server beats this company&apos;s heartbeat on its own — due checks, stale leads, overdue invoices and unowned
              tickets go to their agents, and the worker queue drains them. No browser tab or external cron needed.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => void act('tick')}>
            <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} /> Beat now
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Paused</span>
            <Switch checked={paused} disabled={busy} onCheckedChange={(v) => void act(v ? 'pause' : 'resume')} />
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
        <p>
          <span className="text-foreground">Cadence</span>
          <br />
          {status ? `every ${Math.round(status.intervalMs / 1000)}s` : '—'}
          {status?.cronConfigured ? ' · external cron also set' : ''}
        </p>
        <p>
          <span className="text-foreground">Last beat</span>
          <br />
          {last ? `${new Date(last.startedAt).toLocaleTimeString()} · ${last.ticked.length} ticked` : 'not yet'}
        </p>
        <p>
          <span className="text-foreground">Companies in sweep</span>
          <br />
          {last ? last.workspaces : '—'}
        </p>
        <p>
          <span className="text-foreground">Quiet hours</span>
          <br />
          {workspace?.quietHours ? `${workspace.quietHours.start}–${workspace.quietHours.end}` : 'default 22:00–07:00'}
        </p>
      </div>

      {status?.deferredToCron && (
        <p className="mt-3 rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-xs text-sky-600">
          An external cron trigger is configured (CRON_SECRET), so it owns the scheduled beats and the in-process loop stands
          down. Beat now still runs one beat on demand; unset CRON_SECRET to let the app beat on its own.
        </p>
      )}
      {last?.truncated ? (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600">
          The sweep hit its per-beat cap: {last.truncated} of {last.candidates ?? last.workspaces + last.truncated} workspace(s)
          were not swept this beat.
        </p>
      ) : null}
      {workspace && !workspace.autonomousMode && (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600">
          Autonomous mode is off in Settings, so this company is skipped by the autopilot.
        </p>
      )}
      {workspace && !workspace.heartbeatFeature && (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600">
          The always-on heartbeat feature is switched off under Settings → Features, so this company is skipped.
        </p>
      )}

      <p className="mt-3 flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
        Without a paid model key, runs use the free community model: prompt text leaves this server for that provider. Add a
        provider key under Integrations → AI providers to keep it in-house.
      </p>
      {msg && <p className="mt-2 text-xs text-primary">{msg}</p>}
    </Card>
  );
}
