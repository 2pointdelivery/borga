import 'server-only';
import { getBorgaState, setBorgaState, listBorgaKeys } from './persistence';
import { userWorkspacesKey, userWsKey } from './keys';
import { addNotice } from './heartbeat';
import { fiscalYearEnd, isIso, jurisdictionOf, normalizeFilings } from './filing-catalog';
import { dueReminders, planFilings } from './filing-plan';
import type { Employee, ProactiveNotice, Workspace } from './data';

/** Companies that have confirmed their filing setup (that is the opt-in to reminders). */
export async function listFilingWorkspaces(): Promise<Array<{ userId: string; ws: string }>> {
  const keys = await listBorgaKeys('u::%::ws::%::filings');
  const out: Array<{ userId: string; ws: string }> = [];
  for (const k of keys) {
    const m = /^u::([^:]+)::ws::([^:]+)::filings$/.exec(k);
    if (m) out.push({ userId: m[1], ws: m[2] });
  }
  return out;
}

const remindersKey = (u: string, ws: string) => userWsKey(u, ws, 'filingReminders');

/**
 * Raises in-app notices (and the existing urgent-notice email, when mail is configured) for filings that are coming due or overdue.
 * Quiet until the company has confirmed its filing setup, because before that the dates are guesses.
 */
export async function sweepFilings(u: string, ws: string, today: string = new Date().toISOString().slice(0, 10)): Promise<{ raised: number; skipped?: string }> {
  const state = normalizeFilings(await getBorgaState(userWsKey(u, ws, 'filings')));
  if (!state.profile.confirmed) return { raised: 0, skipped: 'filing setup not confirmed' };
  const workspaces = (await getBorgaState<Workspace[]>(userWorkspacesKey(u))) ?? [];
  const company = workspaces.find((w) => w.id === ws);
  if (!company) return { raised: 0, skipped: 'company not found' };
  const employees = (await getBorgaState<Employee[]>(userWsKey(u, ws, 'employees'))) ?? [];

  const joinedIso = company.createdAt?.slice(0, 10);
  const trackedFrom = state.profile.trackedFrom ?? (isIso(joinedIso) ? joinedIso : today);
  const rows = planFilings({
    jurisdiction: jurisdictionOf(company.country, company.state), profile: state.profile,
    ctx: { employees: state.profile.hasEmployees ?? employees.some((e) => e.status !== 'offboarded'), registered: state.profile.salesTaxRegistered ?? !!company.taxNumber?.trim() },
    fye: fiscalYearEnd(company), today, trackedFrom, records: state.records,
  });

  const sentMap = (await getBorgaState<Record<string, string>>(remindersKey(u, ws))) ?? {};
  const fresh = dueReminders(rows, new Set(Object.keys(sentMap)));
  for (const r of fresh) {
    const notice: ProactiveNotice = {
      id: `n-${Math.random().toString(36).slice(2, 10)}`, title: r.title, body: r.body, severity: r.severity, source: 'scheduler',
      createdAt: new Date().toISOString(), readAt: null,
    };
    await addNotice(notice, ws, u);
    sentMap[r.id] = today;
  }
  if (fresh.length) {
    // keep the dedupe list from growing for ever: drop entries older than 400 days
    const cutoff = Date.now() - 400 * 86_400_000;
    for (const [k, v] of Object.entries(sentMap)) if (Date.parse(v) < cutoff) delete sentMap[k];
    await setBorgaState(remindersKey(u, ws), sentMap);
  }
  return { raised: fresh.length };
}
