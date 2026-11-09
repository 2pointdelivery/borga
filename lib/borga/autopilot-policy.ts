/**
 * Pure autopilot policy: how often to beat, and which workspaces sit a beat
 * out. Kept apart from the loop (and the database) so it is unit-tested.
 */

export type AutopilotSkipReason = 'paused' | 'autonomous mode off' | 'feature "heartbeat" is off' | 'subscription needed';

export interface AutopilotPolicySettings {
  heartbeatPaused?: boolean;
  autonomousMode?: boolean;
  autonomousModeChosen?: boolean;
}

export function autopilotOffValue(raw: string | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function parseAutopilotInterval(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 60_000;
  // Never faster than every 15s (a hot loop against the database), never slower than hourly.
  return Math.min(3_600_000, Math.max(15_000, Math.floor(n)));
}

/**
 * Precedence: an operator-configured external cron trigger (CRON_SECRET) owns
 * the scheduled beats. The in-process loop stands down rather than racing it;
 * the status endpoint and the Runs & Queue card report that, so the capability
 * the operator configured is visible instead of silently doubling.
 */
export function autopilotDefersToCron(cronSecret: string | undefined): boolean {
  return (cronSecret ?? '').trim() !== '';
}

/** Cap a sweep without hiding what was left out: callers log/expose `truncated`. */
export function planSweep<T>(items: readonly T[], max: number): { targets: T[]; truncated: number } {
  if (items.length <= max) return { targets: [...items], truncated: 0 };
  return { targets: items.slice(0, max), truncated: items.length - max };
}

/**
 * Why a workspace is not being beaten, or null when it is eligible.
 * `autonomousMode: false` only counts when the owner chose it: rows saved
 * before the default changed carry the old default, not a decision.
 */
export function autopilotSkipReason(
  settings: AutopilotPolicySettings | null,
  heartbeatEnabled: boolean,
  paymentRequired: boolean,
): AutopilotSkipReason | null {
  if (settings?.heartbeatPaused === true) return 'paused';
  if (settings?.autonomousMode === false && settings?.autonomousModeChosen === true) return 'autonomous mode off';
  if (!heartbeatEnabled) return 'feature "heartbeat" is off';
  if (paymentRequired) return 'subscription needed';
  return null;
}
