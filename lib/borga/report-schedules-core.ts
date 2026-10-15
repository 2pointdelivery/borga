/**
 * Scheduled report emails — pure rules. A schedule names one report (P&L
 * today), a cadence, and rides the workspace's email-update recipients.
 * Next-run math mirrors the scheduled tasks (daily 08:00, weekly Mon 08:00,
 * monthly 1st 08:00, hourly on the hour — company-local hour like the digest).
 */

export type ReportKind = 'pl';
export type ReportCadence = 'daily' | 'weekly' | 'monthly';

export interface ReportSchedule {
  id: string;
  report: ReportKind;
  name: string;
  enabled: boolean;
  cadence: ReportCadence;
  /** Company-local hour (0-23) the email goes out, like the digest hour. */
  hour: number;
  createdAt: string;
  updatedAt: string;
  lastSentAt: string | null;
  nextRun: string | null;
  lastResult?: string;
}

export function normalizeHour(h: unknown, fallback = 8): number {
  const n = Math.round(Number(h));
  return Number.isFinite(n) && n >= 0 && n <= 23 ? n : fallback;
}

/** The P&L period a cadence covers, ending today: trailing 7 days (weekly), the month (monthly), today (daily). */
export function reportPeriod(cadence: ReportCadence, todayIso: string): { from: string; to: string; label: string } {
  const to = todayIso;
  const day = (iso: string, days: number): string => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  if (cadence === 'weekly') {
    const from = day(to, -6);
    return { from, to, label: `${from} to ${to}` };
  }
  if (cadence === 'monthly') {
    return { from: `${to.slice(0, 7)}-01`, to, label: new Date(`${to}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) };
  }
  return { from: to, to, label: to };
}

/** Dedupe key per period: one email per cadence window, re-runs never double-send. */
export function reportPeriodKey(cadence: ReportCadence, todayIso: string): string {
  if (cadence === 'monthly') return `report:pl:month:${todayIso.slice(0, 7)}`;
  if (cadence === 'weekly') return `report:pl:week:${todayIso}`;
  return `report:pl:day:${todayIso}`;
}

/**
 * Next fire time (ISO) for a schedule: the first top-of-the-hour strictly
 * after `nowMs` whose UTC day matches the cadence at exactly the target hour.
 * Company-local hour is applied by the caller (timezone math lives with the
 * sweep, like the digest). Iterating hourly keeps day/hour combinations
 * exact — a day-skip would jump over a same-day fire that is still coming.
 */
export function nextReportRun(cadence: ReportCadence, hour: number, nowMs: number): string {
  const HOUR = 3_600_000;
  let t = Math.floor(nowMs / HOUR) * HOUR + HOUR; // next top of the hour
  for (let guard = 0; guard < 800; guard++) {
    const d = new Date(t);
    const dayOk = cadence === 'daily'
      || (cadence === 'weekly' && d.getUTCDay() === 1)
      || (cadence === 'monthly' && d.getUTCDate() === 1);
    if (dayOk && d.getUTCHours() === hour) return new Date(t).toISOString();
    t += HOUR;
  }
  return new Date(nowMs + 35 * 24 * HOUR).toISOString(); // unreachable in practice; keeps the return honest
}

export function validateReportSchedule(s: Partial<ReportSchedule>): string[] {
  const errors: string[] = [];
  if (s.report !== 'pl') errors.push('Only the P&L report can be scheduled today.');
  if (!s.name || !s.name.trim()) errors.push('Name the schedule.');
  else if (s.name.trim().length > 80) errors.push('The name is too long (80 characters).');
  if (!['daily', 'weekly', 'monthly'].includes(s.cadence ?? '')) errors.push('Pick daily, weekly or monthly.');
  const h = Number(s.hour);
  if (!Number.isInteger(h) || h < 0 || h > 23) errors.push('The hour must be 0-23.');
  return errors;
}

export function newReportScheduleId(): string {
  return `rs-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}
