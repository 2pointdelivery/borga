import 'server-only';
import { getBorgaState, listBorgaKeys, setBorgaState } from './persistence';
import { userWsKey } from './keys';
import { localClock } from './email-core';
import { sendScheduledReport, workspaceInfo } from './email-notify';
import {
  newReportScheduleId,
  nextReportRun,
  normalizeHour,
  validateReportSchedule,
  type ReportSchedule,
} from './report-schedules-core';

/**
 * P&L email schedules, per workspace. Due logic mirrors the digest: the
 * company-local clock decides the day (Mon / 1st / every day) and the hour,
 * the period-key claim inside sendScheduledReport dedupes, and nextRun is
 * maintained for display ("next Monday 08:00") and advanced after each fire.
 */

const schedulesKey = (u: string, ws: string): string => userWsKey(u, ws, 'reportSchedules');

export async function loadReportSchedules(u: string, ws: string): Promise<ReportSchedule[]> {
  const raw = (await getBorgaState<ReportSchedule[]>(schedulesKey(u, ws)).catch(() => null)) ?? [];
  return raw.filter((s) => s && typeof s.id === 'string' && s.report === 'pl');
}

export async function saveReportSchedules(u: string, ws: string, list: ReportSchedule[]): Promise<boolean> {
  return setBorgaState(schedulesKey(u, ws), list).catch(() => false);
}

/** Create or replace one schedule (validated first). Errors read like sentences. */
export async function putReportSchedule(u: string, ws: string, input: Partial<ReportSchedule> & { id?: string }): Promise<{ schedule?: ReportSchedule; errors?: string[] }> {
  const errors = validateReportSchedule(input);
  if (errors.length) return { errors };
  const list = await loadReportSchedules(u, ws);
  const now = new Date().toISOString();
  const id = typeof input.id === 'string' && input.id ? input.id : newReportScheduleId();
  const prev = list.find((s) => s.id === id);
  const cadence = input.cadence!;
  const hour = normalizeHour(input.hour);
  const schedule: ReportSchedule = {
    id,
    report: 'pl',
    name: input.name!.trim().slice(0, 80),
    enabled: input.enabled !== false,
    cadence,
    hour,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    lastSentAt: input.lastSentAt ?? prev?.lastSentAt ?? null,
    nextRun: prev && prev.cadence === cadence && prev.hour === hour ? (input.nextRun ?? prev.nextRun) : nextReportRun(cadence, hour, Date.now()),
    lastResult: input.lastResult ?? prev?.lastResult,
  };
  const next = prev ? list.map((s) => (s.id === id ? schedule : s)) : [...list, schedule];
  if (!(await saveReportSchedules(u, ws, next))) return { errors: ['Could not save (database unavailable).'] };
  return { schedule };
}

export async function deleteReportSchedule(u: string, ws: string, id: string): Promise<boolean> {
  const list = await loadReportSchedules(u, ws);
  if (!list.some((s) => s.id === id)) return false;
  return saveReportSchedules(u, ws, list.filter((s) => s.id !== id));
}

export interface SweepResult {
  checked: number;
  sent: Array<{ id: string; name: string }>;
  skipped: Array<{ id: string; name: string; why: string }>;
}

/** Is this schedule due right now, on the company-local clock? Weekly = Monday, monthly = the 1st, daily = any day. */
function dueNow(s: ReportSchedule, localHour: number, localWeekday: number, localDay: number): boolean {
  if (!s.enabled) return false;
  if (localHour < s.hour) return false;
  if (s.cadence === 'weekly') return localWeekday === 1;
  if (s.cadence === 'monthly') return localDay === 1;
  return true;
}

/** Fire every due schedule once per period window. Called from cron. Never throws. */
export async function sweepReportSchedules(u: string, ws: string, now: Date = new Date()): Promise<SweepResult> {
  const out: SweepResult = { checked: 0, sent: [], skipped: [] };
  try {
    const list = await loadReportSchedules(u, ws);
    if (!list.length) return out;
    const info = await workspaceInfo(u, ws);
    const clock = localClock(now, info.timezone);
    const localWeekday = clock.weekday;
    const localDay = Number(clock.dateIso.slice(8, 10));
    let dirty = false;
    const next = await Promise.all(
      list.map(async (s): Promise<ReportSchedule> => {
        out.checked++;
        if (!dueNow(s, clock.hour, localWeekday, localDay)) return s;
        const r = await sendScheduledReport(u, ws, s.cadence, { now });
        if (r.sent > 0) {
          out.sent.push({ id: s.id, name: s.name });
          dirty = true;
          return { ...s, lastSentAt: now.toISOString(), nextRun: nextReportRun(s.cadence, s.hour, now.getTime()), lastResult: `Sent to ${r.sent} recipient${r.sent === 1 ? '' : 's'}.` };
        }
        if (r.skipped === 'duplicate' || r.skipped === 'rate-limited') return s; // this window already handled; quiet
        const why = r.skipped ?? `${r.failed} failed`;
        out.skipped.push({ id: s.id, name: s.name, why });
        dirty = true;
        return { ...s, nextRun: nextReportRun(s.cadence, s.hour, now.getTime()), lastResult: `Not sent: ${why}.` };
      }),
    );
    if (dirty) await saveReportSchedules(u, ws, next);
  } catch (e) {
    console.error('[report-schedules] sweep failed', (e as Error).message);
  }
  return out;
}

/** Workspaces that have at least one P&L schedule (cron skips the rest cheaply). */
export async function listReportScheduleWorkspaces(): Promise<Array<{ userId: string; ws: string }>> {
  const keys = await listBorgaKeys('u::%::ws::%::reportSchedules').catch(() => [] as string[]);
  const out: Array<{ userId: string; ws: string }> = [];
  for (const k of keys) {
    const m = /^u::([^:]+)::ws::([^:]+)::reportSchedules$/.exec(k);
    if (m) out.push({ userId: m[1], ws: m[2] });
  }
  return out;
}
