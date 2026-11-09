import 'server-only';
import { getBorgaState, listBorgaKeys, setBorgaState } from './persistence';
import { listScheduledWorkspaces, tickWorkspace } from './heartbeat';
import { loadSettings, settingsKey } from './heartbeat-settings';
import { loadFeatures } from './features-server';
import { paymentRequired } from './billing-server';
import { listQueue } from './run-queue';
import { tenantWorkspaceAllowed } from './tenant-guard';
import { autopilotDefersToCron, autopilotOffValue, autopilotSkipReason as policySkip, parseAutopilotInterval, planSweep, type AutopilotSkipReason } from './autopilot-policy';
import type { SettingsState } from './data';

/**
 * Always-on autopilot: the server beats every workspace's heartbeat on its
 * own, so "AI workers working for them" does not depend on a browser tab
 * being open or an external cron job existing.
 *
 * One in-process interval enumerates workspaces from the rows that already
 * describe their autonomous work (`scheduledTasks` and `runQueue`), applies
 * each workspace's own switches (paused, autonomous mode off, heartbeat
 * feature off, subscription lapsed), ticks the shared heartbeat — which hands
 * stale leads, overdue invoices, unowned tickets and due tasks to agents and
 * runs flows/recurring billing — and then wakes the worker pool so the runs
 * it just enqueued actually execute.
 *
 * Exactly one loop per process (anchored on globalThis, so Next dev HMR does
 * not stack intervals), single-flight per tick, unref'd so it never holds the
 * process open, and switchable with BORGA_AUTOPILOT_OFF=1.
 */

export interface AutopilotTarget {
  userId: string;
  ws: string;
}

export type SkipReason = AutopilotSkipReason;

export interface AutopilotTick {
  startedAt: string;
  durationMs: number;
  workspaces: number;
  ticked: string[];
  skipped: Array<{ target: string; reason: SkipReason }>;
  errors: Array<{ target: string; error: string }>;
  /** Jobs waiting on the queue after the tick — the work the beat handed to the workers. */
  enqueued: number;
  /** Workspaces that had autonomous work, before registry filtering. */
  candidates?: number;
  /** Workspaces the per-tick cap left unswept — reported, never silent. */
  truncated?: number;
  /** True when this tick was already in flight and returned without work. */
  overlapped?: boolean;
}

export interface AutopilotStatus {
  enabled: boolean;
  running: boolean;
  intervalMs: number;
  startedAt: string | null;
  ticking: boolean;
  lastTick: AutopilotTick | null;
  cronConfigured: boolean;
  /** True when an external cron trigger (CRON_SECRET) owns the beats and the loop stands down. */
  deferredToCron: boolean;
  disabledByEnv: boolean;
}

interface State {
  timer: ReturnType<typeof setInterval> | null;
  startTimer: ReturnType<typeof setTimeout> | null;
  startedAt: string | null;
  intervalMs: number;
  ticking: boolean;
  lastTick: AutopilotTick | null;
}

const g = globalThis as typeof globalThis & { __borgaAutopilot?: State };
const state: State = (g.__borgaAutopilot ??= {
  timer: null,
  startTimer: null,
  startedAt: null,
  intervalMs: 0,
  ticking: false,
  lastTick: null,
});

/** Safety cap: a single tick never sweeps an unbounded number of companies. */
const MAX_WORKSPACES_PER_TICK = 250;
const FIRST_TICK_DELAY_MS = 5_000;

export function autopilotDisabled(): boolean {
  return autopilotOffValue(process.env.BORGA_AUTOPILOT_OFF);
}

export function autopilotIntervalMs(): number {
  return parseAutopilotInterval(process.env.AUTOPILOT_INTERVAL_MS);
}

export interface AutopilotSweep {
  targets: AutopilotTarget[];
  /** Every workspace with autonomous work, before the cap and registry filter. */
  candidates: number;
  /** Workspaces the cap left out; logged and carried on the tick. */
  truncated: number;
}

/** Workspaces that have autonomous work stored (schedule rows or a run queue). */
export async function listAutopilotWorkspaces(): Promise<AutopilotSweep> {
  const [scheduled, queueKeys] = await Promise.all([
    listScheduledWorkspaces(),
    listBorgaKeys('u::%::ws::%::runQueue'),
  ]);
  const seen = new Map<string, AutopilotTarget>();
  for (const t of scheduled) seen.set(`${t.userId}/${t.ws}`, t);
  for (const key of queueKeys) {
    const m = /^u::([^:]+)::ws::([^:]+)::runQueue$/.exec(key);
    if (m) seen.set(`${m[1]}/${m[2]}`, { userId: m[1], ws: m[2] });
  }
  const { targets: candidates, truncated } = planSweep([...seen.values()], MAX_WORKSPACES_PER_TICK);
  // Only sweep workspaces still listed in their owner's registry. A deleted or
  // renamed company can leave scheduled tasks or a run queue behind; the tenant
  // guard would refuse every read for it, so drop it here instead of logging a
  // failure per key on every beat.
  const allowed: AutopilotTarget[] = [];
  let orphaned = 0;
  for (const target of candidates) {
    if (await tenantWorkspaceAllowed(target.userId, target.ws)) allowed.push(target);
    else orphaned += 1;
  }
  if (orphaned > 0) {
    console.log(`[autopilot] ignored ${orphaned} workspace(s) missing from their owner's registry`);
  }
  if (truncated > 0) {
    // Do not let workspaces fall out of the sweep without a trace: an operator
    // must be able to see that the cap was hit and how much was left out.
    console.warn(`[autopilot] sweep capped at ${MAX_WORKSPACES_PER_TICK} workspaces — ${truncated} left unswept this beat`);
  }
  return { targets: allowed, candidates: seen.size, truncated };
}

/** Why a workspace is not being beaten, or null when it is eligible. */
export async function autopilotSkipReason(userId: string, ws: string): Promise<SkipReason | null> {
  const [settings, flags, unpaid] = await Promise.all([
    loadSettings(ws, userId),
    loadFeatures(userId, ws),
    paymentRequired(userId, ws).catch(() => null),
  ]);
  return policySkip(settings, flags.flags.heartbeat, unpaid !== null);
}

/**
 * One autopilot beat across every eligible workspace. Safe to call from the
 * interval, the status route's "run now", or a test: a concurrent call returns
 * an overlapped tick instead of doing the work twice.
 */
export async function runAutopilotTick(): Promise<AutopilotTick> {
  const startedAt = new Date();
  const result: AutopilotTick = {
    startedAt: startedAt.toISOString(),
    durationMs: 0,
    workspaces: 0,
    ticked: [],
    skipped: [],
    errors: [],
    enqueued: 0,
  };
  if (autopilotDisabled()) {
    result.durationMs = Date.now() - startedAt.getTime();
    return result;
  }
  if (state.ticking) {
    result.overlapped = true;
    result.durationMs = Date.now() - startedAt.getTime();
    return result;
  }
  state.ticking = true;
  try {
    const sweep = await listAutopilotWorkspaces();
    result.workspaces = sweep.targets.length;
    result.candidates = sweep.candidates;
    if (sweep.truncated > 0) result.truncated = sweep.truncated;
    for (const t of sweep.targets) {
      const id = `${t.userId}/${t.ws}`;
      try {
        const skip = await autopilotSkipReason(t.userId, t.ws);
        if (skip) {
          result.skipped.push({ target: id, reason: skip });
          continue;
        }
        await tickWorkspace(t.ws, t.userId);
        // tickWorkspace enqueues due tasks and automation runs; touching the queue
        // starts the pool so those jobs are drained now, not on the next request.
        const queue = await listQueue(t.ws, t.userId);
        // Jobs this beat created — counted by enqueue time, so a worker that
        // claims one immediately still shows up as work handed over.
        result.enqueued += queue.jobs.filter((j) => j.enqueuedAt >= result.startedAt).length;
        result.ticked.push(id);
      } catch (error) {
        const message = (error as Error)?.message ?? String(error);
        console.error(`[autopilot] ${id} failed:`, message);
        result.errors.push({ target: id, error: message.slice(0, 300) });
      }
    }
  } catch (error) {
    console.error('[autopilot] tick failed:', error);
    result.errors.push({ target: 'sweep', error: (error as Error)?.message ?? String(error) });
  } finally {
    state.ticking = false;
    result.durationMs = Date.now() - startedAt.getTime();
    state.lastTick = result;
    const reasons = result.skipped.reduce<Record<string, number>>((acc, s) => {
      acc[s.reason] = (acc[s.reason] ?? 0) + 1;
      return acc;
    }, {});
    console.log(
      `[autopilot] beat ${result.durationMs}ms workspaces=${result.workspaces}${result.truncated ? ` truncated=${result.truncated}` : ''} ticked=${result.ticked.length} skipped=${result.skipped.length}${result.skipped.length ? ` (${Object.entries(reasons).map(([r, n]) => `${r}:${n}`).join(', ')})` : ''} queued=${result.enqueued} errors=${result.errors.length}`,
    );
  }
  return result;
}

/** Start the loop once. Returns the current status; safe to call repeatedly. */
export function startAutopilot(): AutopilotStatus {
  if (state.timer || state.startTimer) return autopilotStatus();
  if (autopilotDisabled()) return autopilotStatus();
  if (process.env.NEXT_PHASE === 'phase-production-build') return autopilotStatus();
  state.intervalMs = autopilotIntervalMs();
  // Precedence: an operator-configured external trigger owns the beats. Racing it
  // would duplicate agent runs, so the loop stands down and the status endpoint
  // (and Runs & Queue card) say why instead of silently doubling the cadence.
  if (autopilotDefersToCron(process.env.CRON_SECRET)) {
    console.log('[autopilot] standing down — CRON_SECRET is set, so /api/borga/cron owns the beats (unset it to let the app beat on its own)');
    return autopilotStatus();
  }
  state.startedAt = new Date().toISOString();
  const run = () => {
    void runAutopilotTick().catch((e) => console.error('[autopilot] unhandled:', e));
  };
  state.startTimer = setTimeout(() => {
    state.startTimer = null;
    run();
    state.timer = setInterval(run, state.intervalMs);
    state.timer.unref?.();
  }, FIRST_TICK_DELAY_MS);
  state.startTimer.unref?.();
  console.log(`[autopilot] on — every ${Math.round(state.intervalMs / 1000)}s`);
  return autopilotStatus();
}

export function stopAutopilot(): void {
  if (state.startTimer) clearTimeout(state.startTimer);
  if (state.timer) clearInterval(state.timer);
  state.startTimer = null;
  state.timer = null;
  state.startedAt = null;
}

export function autopilotStatus(): AutopilotStatus {
  return {
    enabled: !autopilotDisabled(),
    running: state.timer !== null,
    intervalMs: state.intervalMs || autopilotIntervalMs(),
    startedAt: state.startedAt,
    ticking: state.ticking,
    lastTick: state.lastTick,
    cronConfigured: Boolean(process.env.CRON_SECRET),
    deferredToCron: autopilotDefersToCron(process.env.CRON_SECRET),
    disabledByEnv: autopilotDisabled(),
  };
}

/** Workspace pause/resume — the same switch the Settings heartbeat uses. */
export async function setWorkspaceAutopilotPaused(userId: string, ws: string, paused: boolean): Promise<boolean> {
  const key = settingsKey(ws, userId);
  const settings = (await getBorgaState<SettingsState>(key)) ?? null;
  const next = {
    notifications: { tasks: true, handoffs: true, sync: false, voice: true, kpi: false },
    crmUrl: '',
    ...(settings ?? {}),
    heartbeatPaused: paused,
  };
  return setBorgaState(key, next);
}
