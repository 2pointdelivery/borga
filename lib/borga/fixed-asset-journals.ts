// From the engine to the ledger: which journal entries are due, what they contain, and what has already been posted.
//
// Depreciation is posted month by month, in order. Each month's charge per asset is "what the schedule says has been depreciated
// through this month, less what has already been posted", so the posting corrects itself: an asset added late, or one whose
// estimates were corrected, catches up in the next entry instead of leaving a gap, and nothing is ever posted twice. The entry says
// when it includes a catch-up. A month that falls inside a closed period (Book Closure) is never posted into: the plan stops there.

import { isIso } from './filing-catalog';
import { ASSET_ACCOUNTS, type AssetPolicy } from './fixed-asset-standards';
import {
  cumulativeDepreciation, isPeriod, monthEnd, monthOf, nextMonth, simulateAsset,
  type AccountKey, type FixedAsset, type Posting, type Simulation,
} from './fixed-assets';

export interface RunLine {
  assetId: string;
  /** Depreciation posted for this asset in this run. */
  amount: number;
  /** Revaluation surplus transferred to retained earnings for this asset in this run. */
  transfer: number;
  catchUp: boolean;
}

export interface PostedEntryRef {
  assetId: string;
  /** 'acquisition' or the event id. */
  key: string;
  journalId: string;
}

export interface DepreciationRun {
  id: string;
  period: string;
  postedAt: string;
  depreciationJournalId?: string;
  transferJournalId?: string;
  lines: RunLine[];
  /** The acquisition and event entries posted together with this run. */
  events: PostedEntryRef[];
}

export interface FixedAssetsState {
  assets: FixedAsset[];
  runs: DepreciationRun[];
  /** Move revaluation surplus to retained earnings as the asset is used (IAS 16.41). */
  transferSurplus: boolean;
}

export const EMPTY_FIXED_ASSETS: FixedAssetsState = { assets: [], runs: [], transferSurplus: true };

export interface JournalLineDraft {
  accountId: string;
  debit: number;
  credit: number;
}

export interface EntryDraft {
  kind: 'depreciation' | 'transfer' | 'event';
  memo: string;
  description: string;
  reference: string;
  dateIso: string;
  lines: JournalLineDraft[];
  /** For an event entry. */
  assetId?: string;
  key?: string;
  projectId?: string;
}

export interface PeriodPlan {
  period: string;
  depreciation: number;
  transfer: number;
  catchUp: number;
  lines: RunLine[];
  entries: EntryDraft[];
}

export interface PostingPlan {
  periods: PeriodPlan[];
  /** Posting stopped here because an entry falls inside a closed period. */
  blocked?: { period: string; label: string };
  /** Assets whose figures cannot be relied on: nothing is posted for them. */
  problems: Array<{ assetId: string; name: string; issues: string[] }>;
}

export interface PlanContext {
  cashAccountId?: string;
  closures: Array<{ startDate: string; endDate: string; label: string }>;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function accountId(key: AccountKey, asset: FixedAsset, ctx: PlanContext): string | undefined {
  if (key === 'counter') return asset.counterAccountId ?? ctx.cashAccountId;
  if (key === 'cost' || key === 'accumulated' || key === 'expense' || key === 'surplus') return asset.accounts?.[key] ?? ASSET_ACCOUNTS[key].id;
  return ASSET_ACCOUNTS[key].id;
}

const postedKeys = (a: FixedAsset): Set<string> => {
  const s = new Set<string>();
  if (a.acquisitionJournalId) s.add('acquisition');
  for (const e of a.events) if (e.journalId) s.add(e.id);
  return s;
};

export const periodLabel = (period: string) => {
  const [y, m] = period.split('-');
  return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(m) - 1]} ${y}`;
};

/** The entries to post so that the ledger is up to date through `through` (a 'YYYY-MM'). */
export function planPostings(state: FixedAssetsState, policy: AssetPolicy, through: string, ctx: PlanContext): PostingPlan {
  const plan: PostingPlan = { periods: [], problems: [] };
  if (!isPeriod(through) || state.assets.length === 0) return plan;

  const sims = new Map<string, Simulation>();
  const usable = new Set<string>();
  for (const a of state.assets) {
    const sim = simulateAsset(a, policy, through, { transferSurplus: state.transferSurplus });
    sims.set(a.id, sim);
    if (sim.issues.length) plan.problems.push({ assetId: a.id, name: a.name, issues: sim.issues });
    else usable.add(a.id);
  }

  const lastRun = state.runs.reduce<string | undefined>((m, r) => (m === undefined || r.period > m ? r.period : m), undefined);
  const earliest = state.assets.map((a) => (isIso(a.acquiredOn) ? monthOf(a.acquiredOn) : undefined)).filter((x): x is string => !!x).sort()[0];
  if (!earliest) return plan;
  let period = lastRun ? nextMonth(lastRun) : earliest;

  // running totals of what has been posted, per asset, updated as we plan forward
  const postedDep = new Map<string, number>();
  const postedTransfer = new Map<string, number>();
  for (const r of state.runs) for (const l of r.lines) {
    postedDep.set(l.assetId, r2((postedDep.get(l.assetId) ?? 0) + l.amount));
    postedTransfer.set(l.assetId, r2((postedTransfer.get(l.assetId) ?? 0) + l.transfer));
  }
  const already = new Map<string, Set<string>>(state.assets.map((a) => [a.id, postedKeys(a)]));

  for (; period <= through; period = nextMonth(period)) {
    const end = monthEnd(period);
    const lines: RunLine[] = [];
    const entries: EntryDraft[] = [];

    for (const a of state.assets) {
      if (!usable.has(a.id)) continue;
      const sim = sims.get(a.id)!;
      const row = sim.months.find((m) => m.period === period);
      const cum = cumulativeDepreciation(sim, period);
      const amount = r2(cum - (postedDep.get(a.id) ?? 0));
      const cumTransfer = r2(sim.months.filter((m) => m.period <= period).reduce((s, m) => s + m.surplusTransfer, 0));
      const transfer = r2(cumTransfer - (postedTransfer.get(a.id) ?? 0));
      if (Math.abs(amount) < 0.005 && Math.abs(transfer) < 0.005) continue;
      const expected = row?.depreciation ?? 0;
      lines.push({ assetId: a.id, amount, transfer, catchUp: Math.abs(amount - expected) > 0.01 });
    }

    const depLines = lines.filter((l) => Math.abs(l.amount) >= 0.005);
    if (depLines.length) {
      const byAccount = new Map<string, number>();
      const bump = (id: string, d: number) => byAccount.set(id, r2((byAccount.get(id) ?? 0) + d));
      for (const l of depLines) {
        const a = state.assets.find((x) => x.id === l.assetId)!;
        bump(accountId('expense', a, ctx)!, l.amount); // debit
        bump(accountId('accumulated', a, ctx)!, -l.amount); // credit
      }
      const catchUp = r2(depLines.filter((l) => l.catchUp).reduce((s, l) => s + l.amount, 0));
      entries.push({
        kind: 'depreciation', memo: `Depreciation: ${periodLabel(period)}`,
        description: `Monthly depreciation for ${depLines.length} fixed asset${depLines.length === 1 ? '' : 's'}${catchUp !== 0 ? ` (includes ${catchUp.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} catch-up for earlier months)` : ''}.`,
        reference: `FA-${period}`, dateIso: end,
        lines: [...byAccount.entries()].filter(([, v]) => Math.abs(v) >= 0.005).map(([id, v]) => ({ accountId: id, debit: v > 0 ? v : 0, credit: v < 0 ? -v : 0 })),
      });
    }

    const transferTotal = r2(lines.reduce((s, l) => s + l.transfer, 0));
    if (Math.abs(transferTotal) >= 0.005) {
      entries.push({
        kind: 'transfer', memo: `Revaluation surplus transferred to retained earnings: ${periodLabel(period)}`,
        description: 'Surplus realised through use of the revalued assets: depreciation on the revalued amount less depreciation on original cost (IAS 16.41). Not part of profit or loss.',
        reference: `FA-${period}-RS`, dateIso: end,
        lines: [
          { accountId: ASSET_ACCOUNTS.surplus.id, debit: transferTotal > 0 ? transferTotal : 0, credit: transferTotal < 0 ? -transferTotal : 0 },
          { accountId: ASSET_ACCOUNTS.retained.id, debit: transferTotal < 0 ? -transferTotal : 0, credit: transferTotal > 0 ? transferTotal : 0 },
        ],
      });
    }

    // acquisitions and events dated up to the end of this month that are not posted yet
    const evEntries: EntryDraft[] = [];
    for (const a of state.assets) {
      if (!usable.has(a.id)) continue;
      const sim = sims.get(a.id)!;
      const done = already.get(a.id)!;
      for (const p of sim.postings) {
        if (done.has(p.key) || p.date > end) continue;
        const draft = entryForPosting(p, a, ctx);
        if (!draft) continue; // the counter account is not known: reported by the screen
        evEntries.push(draft);
        done.add(p.key);
      }
    }
    evEntries.sort((x, y) => x.dateIso.localeCompare(y.dateIso));
    entries.push(...evEntries);

    if (entries.length === 0) continue;

    const closed = entries.map((e) => ctx.closures.find((c) => e.dateIso >= c.startDate && e.dateIso <= c.endDate)).find(Boolean);
    if (closed) {
      plan.blocked = { period, label: closed.label };
      // roll back what this period reserved so the caller does not think those events are planned
      for (const e of evEntries) if (e.assetId && e.key) already.get(e.assetId)?.delete(e.key);
      break;
    }

    for (const l of lines) {
      postedDep.set(l.assetId, r2((postedDep.get(l.assetId) ?? 0) + l.amount));
      postedTransfer.set(l.assetId, r2((postedTransfer.get(l.assetId) ?? 0) + l.transfer));
    }
    plan.periods.push({ period, depreciation: r2(lines.reduce((s, l) => s + l.amount, 0)), transfer: transferTotal, catchUp: r2(lines.filter((l) => l.catchUp).reduce((s, l) => s + l.amount, 0)), lines, entries });
  }
  return plan;
}

const slug = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20);

function entryForPosting(p: Posting, a: FixedAsset, ctx: PlanContext): EntryDraft | undefined {
  const lines: JournalLineDraft[] = [];
  for (const l of p.lines) {
    const id = accountId(l.account, a, ctx);
    if (!id) return undefined;
    lines.push({ accountId: id, debit: l.debit, credit: l.credit });
  }
  return {
    kind: 'event', memo: p.memo, description: `${p.memo}${a.tag ? ` (${a.tag})` : ''}. Posted by the fixed asset register.`,
    reference: ['FA', slug(a.tag || a.name), p.key === 'acquisition' ? 'ACQ' : slug(p.key).slice(-6)].filter(Boolean).join('-'),
    dateIso: p.date, lines, assetId: a.id, key: p.key, projectId: a.projectId,
  };
}

/** Whether an acquisition or event entry cannot be built because no account is set for its other side (a purchase needs a cash or payable account). */
export function missingCounterAccount(state: FixedAssetsState, policy: AssetPolicy, through: string, ctx: PlanContext): string[] {
  const out: string[] = [];
  for (const a of state.assets) {
    if (accountId('counter', a, ctx)) continue;
    const sim = simulateAsset(a, policy, through);
    const done = postedKeys(a);
    if (sim.postings.some((p) => !done.has(p.key) && p.lines.some((l) => l.account === 'counter'))) out.push(a.name);
  }
  return out;
}

/** The balance (debits less credits) of an account on posted entries, optionally up to a date. */
export function ledgerBalance(journals: Array<{ status: string; dateIso: string; lines: Array<{ accountId: string; debit: number; credit: number }> }>, id: string, through?: string): number {
  let b = 0;
  for (const j of journals) {
    if (j.status !== 'posted') continue;
    if (through && j.dateIso > through) continue;
    for (const l of j.lines) if (l.accountId === id) b += l.debit - l.credit;
  }
  return r2(b);
}

// ── saved state ───────────────────────────────────────────────────────────────────────────────────────────────────────

const METHODS = new Set(['straight-line', 'declining-balance', 'sum-of-years', 'units-of-production', 'none']);
const CONVENTIONS = new Set(['daily', 'full-month', 'mid-month', 'next-month']);

/** Accepts whatever was saved and returns a state the screen can always render: damaged assets are dropped, not guessed at. */
export function normalizeFixedAssets(raw: unknown): FixedAssetsState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<FixedAssetsState>;
  const assets = Array.isArray(r.assets)
    ? r.assets.filter((a): a is FixedAsset => !!a && typeof a.id === 'string' && typeof a.name === 'string' && typeof a.cost === 'number' && METHODS.has(a.method) && CONVENTIONS.has(a.convention)
        && (a.model === 'cost' || a.model === 'revaluation') && typeof a.acquiredOn === 'string').map((a) => ({ ...a, events: Array.isArray(a.events) ? a.events.filter((e) => e && typeof e.id === 'string' && typeof e.kind === 'string' && typeof e.date === 'string') : [] }))
    : [];
  const runs = Array.isArray(r.runs)
    ? r.runs.filter((x): x is DepreciationRun => !!x && typeof x.id === 'string' && isPeriod(x.period) && Array.isArray(x.lines)).map((x) => ({ ...x, events: Array.isArray(x.events) ? x.events : [] }))
    : [];
  return { assets, runs, transferSurplus: r.transferSurplus !== false };
}
