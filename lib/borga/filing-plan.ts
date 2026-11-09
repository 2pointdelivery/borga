// Turns the catalog into the list a company actually sees: its applicable filings, with their state (overdue, due soon, filed...),
// limited to what is worth looking at, so a monthly return does not bury the screen under a hundred rows.

import {
  addDays, addMonths, applicableObligations, daysBetween, dueStateOf, filingsOf, isIso, recordKey,
  type DueState, type FilingDue, type FilingProfile, type FilingRecord, type FiscalYearEnd, type Jurisdiction, type Obligation, type ResolvedContext,
} from './filing-catalog';

export interface PlanRow {
  ob: Obligation;
  filing: FilingDue;
  record?: FilingRecord;
  /** The date that counts: the user's own date if they set one, else the rule's. */
  due: string | null;
  state: DueState;
  daysLeft: number | null;
}

export interface PlanInput {
  jurisdiction: Jurisdiction;
  profile: FilingProfile;
  ctx: ResolvedContext;
  fye: FiscalYearEnd;
  today: string;
  /** Filings due before this date are not tracked (the day the company joined unless the user moved it). */
  trackedFrom: string;
  records: FilingRecord[];
  /** Upcoming filings further away than this are left out, except the next one of each obligation. */
  horizonDays?: number;
}

export const DEFAULT_HORIZON_DAYS = 150;

export function effectiveDue(due: string | null, record?: FilingRecord): string | null {
  return record?.dueOverride && isIso(record.dueOverride) ? record.dueOverride : due;
}

export function planFilings(input: PlanInput): PlanRow[] {
  const { jurisdiction, profile, ctx, fye, today, trackedFrom, records } = input;
  const horizon = input.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const byKey = new Map(records.map((r) => [r.key, r]));
  const obligations = applicableObligations(jurisdiction, profile, ctx);
  const rows: PlanRow[] = [];

  for (const ob of obligations) {
    // a period can end up to a year and a half before its return is due (annual returns), and we look a year ahead
    const filings = filingsOf(ob, profile, fye, addMonths(trackedFrom, -18, 'end'), addMonths(today, 13, 'end'));
    const mine: PlanRow[] = [];
    for (const filing of filings) {
      const record = byKey.get(recordKey(ob.id, filing.key));
      const due = effectiveDue(filing.due, record);
      if (due && due < trackedFrom && !record) continue;
      // no date to compare (the user enters it): judge by the period instead, so last year's local permit is not listed
      if (!due && filing.period.end < trackedFrom && !record) continue;
      const state = dueStateOf(filing.due, record, today);
      mine.push({ ob, filing, record, due, state, daysLeft: due ? daysBetween(today, due) : null });
    }
    mine.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));

    let nextShown = false;
    for (const row of mine) {
      if (row.state === 'filed' || row.state === 'not-required' || row.state === 'overdue') {
        rows.push(row);
      } else if (row.state === 'needs-date') {
        // a return whose date we cannot compute is only worth showing once its period is nearly over
        if (row.filing.period.end <= addDays(today, 30)) rows.push(row);
      } else if ((row.daysLeft ?? 0) <= horizon || !nextShown) {
        rows.push(row);
        nextShown = true;
      }
    }
  }
  return rows.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.ob.name.localeCompare(b.ob.name));
}

export interface PlanSummary {
  overdue: number;
  dueSoon: number;
  needsDate: number;
  filed: number;
}

export function summarize(rows: PlanRow[]): PlanSummary {
  const n = (s: DueState) => rows.filter((r) => r.state === s).length;
  return { overdue: n('overdue'), dueSoon: n('due-soon'), needsDate: n('needs-date'), filed: n('filed') };
}

// ── reminders ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export const REMINDER_DAYS = [30, 14, 7, 1] as const;
/** Most reminders one sweep may raise for one company, so a catch-up does not flood the inbox. */
export const MAX_REMINDERS_PER_SWEEP = 8;

export interface Reminder {
  /** Dedupe id: the filing and how close it is. The same id is never raised twice. */
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'noteworthy' | 'urgent';
}

const STAGE_TEXT: Record<string, string> = { preparing: 'being prepared', review: 'waiting for review' };

/**
 * The reminders to raise now: for each open filing, one when it first comes within 30, 14, 7 and 1 days of its date, and one a
 * week after it is overdue, and every week after that. Only the current step is raised (a filing that is 5 days away gets the 7-day
 * reminder, not also the 30 and 14), and ids already in `sent` are skipped.
 */
export function dueReminders(rows: PlanRow[], sent: ReadonlySet<string>): Reminder[] {
  const out: Reminder[] = [];
  for (const r of rows) {
    if (r.state === 'filed' || r.state === 'not-required' || r.state === 'needs-date' || r.daysLeft === null || !r.due) continue;
    const base = `${r.ob.id}|${r.filing.key}`;
    const d = r.daysLeft;
    const stage = r.record && STAGE_TEXT[r.record.status] ? ` It is ${STAGE_TEXT[r.record.status]}.` : '';
    const what = `${r.ob.name}${r.ob.form ? ` (${r.ob.form})` : ''}, ${r.filing.label}, ${r.ob.authority}`;
    if (d < 0) {
      const weeks = Math.floor(-d / 7);
      const id = `${base}@overdue-${weeks}`;
      if (sent.has(id)) continue;
      out.push({ id, title: `Overdue: ${r.ob.name}`, body: `${what} was due ${r.due}, ${-d} day${-d === 1 ? '' : 's'} ago. File it or mark it filed.${stage}`, severity: 'urgent' });
    } else {
      const t = [...REMINDER_DAYS].reverse().find((n) => d <= n); // the closest step that has been reached
      if (t === undefined) continue;
      const id = `${base}@${t}`;
      if (sent.has(id)) continue;
      out.push({
        id,
        title: d === 0 ? `Due today: ${r.ob.name}` : `Due in ${d} day${d === 1 ? '' : 's'}: ${r.ob.name}`,
        body: `${what} is due ${r.due}.${stage}`,
        severity: t <= 7 ? 'noteworthy' : 'info',
      });
    }
  }
  // the most urgent first, then cap
  const rank = { urgent: 0, noteworthy: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, MAX_REMINDERS_PER_SWEEP);
}
