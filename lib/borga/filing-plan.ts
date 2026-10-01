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
