// The fixed asset engine: given an asset and the company's accounting framework, works out month by month what depreciation, impairment,
// revaluation and disposal do to the books, and the journal postings each one needs. Pure functions, no store and no UI.
//
// How it works. One loop walks the asset's life a month at a time, keeping its gross amount, accumulated depreciation and
// impairment, revaluation surplus and remaining useful life. Depreciation each month is the method applied to what is left to
// depreciate (carrying amount less residual value) over what is left of the life, so anything that changes those, such as a
// revaluation, an impairment, a capital improvement or a new estimate of life, takes effect from then on and never rewrites the
// past (IAS 8, ASC 250). Events dated inside a month take effect at the end of that month, after that month's depreciation;
// disposal and held-for-sale stop depreciation at their own date.
//
// What it does not do: tax depreciation (capital cost allowance, MACRS, capital allowances), leases (right-of-use assets), intangible
// assets, or biological and investment property. Those have their own standards.

import { addMonths, daysIn, isIso } from './filing-catalog';
import type { AssetPolicy, DepreciationMethod } from './fixed-asset-standards';
import { categoryOf } from './fixed-asset-standards';

export type Convention = 'daily' | 'full-month' | 'mid-month' | 'next-month';
export type RevaluationMethod = 'eliminate' | 'proportional';
export type MeasurementModel = 'cost' | 'revaluation';
export type AssetStatus = 'under-construction' | 'in-use' | 'held-for-sale' | 'disposed';

export const CONVENTION_LABEL: Record<Convention, string> = {
  daily: 'Daily, from the date available for use',
  'full-month': 'Full month in the month acquired, none in the month sold',
  'mid-month': 'Half a month in the month acquired and in the month sold',
  'next-month': 'From the month after it is acquired, full month in the month sold',
};

interface EventBase {
  id: string;
  date: string;
  note?: string;
  /** Set once the journal entry for this event has been posted. */
  journalId?: string;
}

export type AssetEvent =
  | (EventBase & { kind: 'usage'; units: number })
  | (EventBase & { kind: 'revaluation'; fairValue: number })
  /** `recoverable` is the recoverable amount (IFRS) or the fair value (US GAAP, ASPE). */
  | (EventBase & { kind: 'impairment'; recoverable: number; undiscountedCashFlows?: number })
  | (EventBase & { kind: 'impairment-reversal'; recoverable: number })
  | (EventBase & { kind: 'improvement'; amount: number; extendsLifeMonths?: number })
  | (EventBase & { kind: 'estimate-change'; remainingLifeMonths?: number; residual?: number; method?: DepreciationMethod; dbFactor?: number; unitsTotal?: number })
  | (EventBase & { kind: 'held-for-sale'; fairValueLessCosts: number })
  | (EventBase & { kind: 'reclassify-in-use' })
  | (EventBase & { kind: 'disposal'; proceeds: number; costs?: number });

export type AssetEventKind = AssetEvent['kind'];

export const EVENT_LABEL: Record<AssetEventKind, string> = {
  usage: 'Usage (units produced)',
  revaluation: 'Revaluation to fair value',
  impairment: 'Impairment',
  'impairment-reversal': 'Reversal of impairment',
  improvement: 'Improvement (capital addition)',
  'estimate-change': 'Change in estimate (life, residual value, method)',
  'held-for-sale': 'Classified as held for sale',
  'reclassify-in-use': 'Back in use (no longer held for sale)',
  disposal: 'Disposal (sale or scrapping)',
};

export interface FixedAsset {
  id: string;
  tag?: string;
  name: string;
  category: string;
  description?: string;
  acquiredOn: string;
  /** The date the asset is ready for use; depreciation starts here. Defaults to the acquisition date; empty while under construction. */
  availableFrom?: string;
  cost: number;
  residual: number;
  usefulLifeMonths: number;
  method: DepreciationMethod;
  /** Declining balance: 2 is "double declining", 1.5 is "150%". */
  dbFactor?: number;
  /** Declining balance: switch to straight-line once that gives a larger charge. */
  switchToStraightLine?: boolean;
  /** Units of production: the units the asset is expected to produce over its life. */
  unitsTotal?: number;
  convention: Convention;
  model: MeasurementModel;
  revaluationMethod?: RevaluationMethod;
  /** 'register-posts': this register books the purchase. 'already-in-gl': it is already in the ledger (from a bill or a journal). */
  glMode: 'register-posts' | 'already-in-gl';
  counterAccountId?: string;
  accounts?: Partial<Record<'cost' | 'accumulated' | 'expense' | 'surplus', string>>;
  projectId?: string;
  acquisitionJournalId?: string;
  events: AssetEvent[];
  notes?: string;
  createdAt?: string;
}

export type AccountKey = 'cost' | 'accumulated' | 'expense' | 'surplus' | 'retained' | 'impairment' | 'lossOnDisposal' | 'gainOnDisposal' | 'reversal' | 'counter';

export interface PostingLine {
  account: AccountKey;
  debit: number;
  credit: number;
}

export interface Posting {
  /** 'acquisition' or the event id. */
  key: string;
  assetId: string;
  date: string;
  memo: string;
  lines: PostingLine[];
}

export interface MonthRow {
  period: string;
  depreciation: number;
  /** What depreciation would have been on historical cost (only differs when the asset has been revalued). */
  depreciationOnCost: number;
  /** Revaluation surplus moved to retained earnings as the asset is used (IAS 16.41). */
  surplusTransfer: number;
  grossOpen: number;
  accumOpen: number;
  grossClose: number;
  accumClose: number;
  surplusClose: number;
  additions: number;
  disposalGross: number;
  disposalAccum: number;
  impairmentLoss: number;
  impairmentReversal: number;
  revaluationOci: number;
  revaluationPl: number;
  status: AssetStatus;
}

export interface Simulation {
  months: MonthRow[];
  postings: Posting[];
  /** Problems with the asset or its events under this framework. A non-empty list means the figures are not to be relied on. */
  issues: string[];
  /** Notes about events that had no effect (for example, an impairment test that was passed). */
  info: string[];
}

export interface SimOptions {
  /** Turn the revaluation surplus transfer on or off (default on). */
  transferSurplus?: boolean;
}

interface CoreFlags {
  skipRevaluations?: boolean;
  skipImpairments?: boolean;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const EPS = 0.005;

// ── months ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const monthOf = (iso: string) => iso.slice(0, 7);
export const monthEnd = (period: string) => `${period}-${String(daysIn(Number(period.slice(0, 4)), Number(period.slice(5, 7)))).padStart(2, '0')}`;
export const nextMonth = (period: string) => monthOf(addMonths(`${period}-01`, 1, 1));
export const isPeriod = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/** The share of the month the asset is in service in the month it comes into use. */
function startFraction(conv: Convention, date: string): number {
  const day = Number(date.slice(8, 10));
  const dim = daysIn(Number(date.slice(0, 4)), Number(date.slice(5, 7)));
  switch (conv) {
    case 'daily': return (dim - day + 1) / dim;
    case 'full-month': return 1;
    case 'mid-month': return 0.5;
    case 'next-month': return 0;
  }
}

/** The share of the month the asset is in service in the month it stops (sale, held for sale). */
function stopFraction(conv: Convention, date: string): number {
  const day = Number(date.slice(8, 10));
  const dim = daysIn(Number(date.slice(0, 4)), Number(date.slice(5, 7)));
  switch (conv) {
    case 'daily': return day / dim;
    case 'full-month': return 0;
    case 'mid-month': return 0.5;
    case 'next-month': return 1;
  }
}

// ── validation ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function validateAsset(a: FixedAsset, policy: AssetPolicy): string[] {
  const out: string[] = [];
  if (!a.name.trim()) out.push('The asset needs a name.');
  if (!isIso(a.acquiredOn)) out.push('The acquisition date must be a calendar date.');
  if (a.availableFrom && !isIso(a.availableFrom)) out.push('The date available for use must be a calendar date.');
  if (a.availableFrom && isIso(a.acquiredOn) && a.availableFrom < a.acquiredOn) out.push('The asset cannot be available for use before it is acquired.');
  if (!(a.cost > 0)) out.push('The cost must be more than zero.');
  if (a.residual < 0) out.push('The residual value cannot be negative.');
  if (a.residual > a.cost) out.push('The residual value cannot be more than the cost.');
  const depreciates = a.method !== 'none';
  if (depreciates && !(a.usefulLifeMonths > 0)) out.push('A depreciated asset needs a useful life of at least one month.');
  if (a.method === 'units-of-production' && !(a.unitsTotal && a.unitsTotal > 0)) out.push('Units of production needs the total units the asset is expected to produce.');
  if (a.method === 'declining-balance' && a.dbFactor !== undefined && !(a.dbFactor > 0 && a.dbFactor <= 4)) out.push('The declining balance factor must be between 0 and 4 (2 is double declining).');
  if (a.model === 'revaluation' && !policy.allowsRevaluation) out.push(`${policy.label} does not allow the revaluation model: carry this asset at cost.`);

  let disposedOn: string | undefined;
  for (const e of a.events) {
    if (!isIso(e.date)) { out.push(`${EVENT_LABEL[e.kind]}: the date must be a calendar date.`); continue; }
    if (isIso(a.acquiredOn) && e.date < a.acquiredOn) out.push(`${EVENT_LABEL[e.kind]} on ${e.date} is before the asset was acquired.`);
    if (e.kind === 'disposal') disposedOn = e.date;
    if (e.kind === 'revaluation' && !policy.allowsRevaluation) out.push(`A revaluation on ${e.date} is not allowed under ${policy.label}.`);
    if (e.kind === 'revaluation' && a.model !== 'revaluation') out.push(`A revaluation on ${e.date} needs the asset to use the revaluation model.`);
    if (e.kind === 'revaluation' && !(e.fairValue >= 0)) out.push(`The fair value on ${e.date} must not be negative.`);
    if (e.kind === 'impairment-reversal' && !policy.allowsImpairmentReversal) out.push(`Reversing an impairment loss is not allowed under ${policy.label}.`);
    if (e.kind === 'impairment-reversal' && a.model === 'revaluation') out.push(`For a revalued asset, record an increase as a revaluation (${e.date}).`);
    if (e.kind === 'impairment' && policy.impairmentTest === 'recoverability-then-fair-value' && typeof e.undiscountedCashFlows !== 'number') {
      out.push(`${policy.label} first tests recoverability: enter the undiscounted cash flows for the impairment on ${e.date}.`);
    }
    if (e.kind === 'usage' && !(e.units >= 0)) out.push(`Usage on ${e.date} cannot be negative.`);
    if (e.kind === 'improvement' && !(e.amount > 0)) out.push(`The improvement on ${e.date} must be more than zero.`);
    if (e.kind === 'disposal' && !(e.proceeds >= 0)) out.push(`Disposal proceeds on ${e.date} cannot be negative.`);
  }
  if (disposedOn) for (const e of a.events) if (e.kind !== 'disposal' && isIso(e.date) && e.date > disposedOn) out.push(`${EVENT_LABEL[e.kind]} on ${e.date} is after the asset was disposed of.`);
  if (a.events.filter((e) => e.kind === 'disposal').length > 1) out.push('An asset can only be disposed of once.');
  return out;
}

// ── the simulation ────────────────────────────────────────────────────────────────────────────────────────────────────

interface Segment {
  method: DepreciationMethod;
  dbFactor: number;
  dbRate: number;
  switchSl: boolean;
  /** sum of the years' digits */
  sydBase: number;
  sydConsumed: number;
  sydYears: number;
  unitsTotal: number;
}

/**
 * Walks the asset from its acquisition month through `until` (a 'YYYY-MM'), one month at a time.
 * `flags` are for the internal comparison runs (what depreciation would be at cost; what the carrying amount would be with no impairment).
 */
function run(asset: FixedAsset, policy: AssetPolicy, until: string, opts: SimOptions, flags: CoreFlags, shadows?: { cost?: Map<string, number>; noImpairment?: Map<string, number> }): Simulation {
  const issues: string[] = [];
  const info: string[] = [];
  const months: MonthRow[] = [];
  const postings: Posting[] = [];
  if (!isIso(asset.acquiredOn) || !isPeriod(until)) return { months, postings, issues: validateAsset(asset, policy), info };

  const events = asset.events.filter((e) => isIso(e.date)).map((e, i) => ({ e, i })).sort((a, b) => a.e.date.localeCompare(b.e.date) || a.i - b.i).map((x) => x.e);
  const byMonth = new Map<string, AssetEvent[]>();
  for (const e of events) {
    if (flags.skipRevaluations && e.kind === 'revaluation') continue;
    if (flags.skipImpairments && (e.kind === 'impairment' || e.kind === 'impairment-reversal')) continue;
    const m = monthOf(e.date);
    (byMonth.get(m) ?? byMonth.set(m, []).get(m)!).push(e);
  }

  const depStartDate = asset.availableFrom && isIso(asset.availableFrom) && asset.availableFrom >= asset.acquiredOn
    ? asset.availableFrom
    : categoryOf(asset.category).id === 'construction' ? undefined : asset.acquiredOn;

  let gross = 0;
  let accum = 0;
  let surplus = 0;
  let plLossCum = 0; // revaluation losses taken through profit or loss and not yet reversed
  let impairmentCum = 0; // impairment losses recognised on a cost-model asset and not yet reversed
  let status: AssetStatus = depStartDate ? 'in-use' : 'under-construction';
  let residual = asset.residual;
  let remaining = asset.usefulLifeMonths; // months, including a part month at the start
  let usedUnits = 0;
  let seg: Segment = newSegment(asset.method, asset.dbFactor ?? 2, asset.switchToStraightLine !== false, remaining, 0, 0, asset.unitsTotal ?? 0);
  const startMonth = monthOf(asset.acquiredOn);
  const depStartMonth = depStartDate ? monthOf(depStartDate) : undefined;

  const restartSyd = (method: DepreciationMethod) => {
    if (method === 'sum-of-years') {
      seg.sydBase = Math.max(0, gross - accum - residual);
      seg.sydConsumed = 0;
      seg.sydYears = Math.max(1, Math.ceil(remaining / 12));
    }
  };

  for (let period = startMonth; period <= until; period = nextMonth(period)) {
    const evs = byMonth.get(period) ?? [];
    const row: MonthRow = {
      period, depreciation: 0, depreciationOnCost: 0, surplusTransfer: 0, grossOpen: gross, accumOpen: accum, grossClose: gross, accumClose: accum, surplusClose: surplus,
      additions: 0, disposalGross: 0, disposalAccum: 0, impairmentLoss: 0, impairmentReversal: 0, revaluationOci: 0, revaluationPl: 0, status,
    };

    // acquisition
    if (period === startMonth) {
      gross = r2(asset.cost);
      row.additions += gross;
      if (asset.glMode === 'register-posts') {
        postings.push({ key: 'acquisition', assetId: asset.id, date: asset.acquiredOn, memo: `Acquisition of ${asset.name}`, lines: [{ account: 'cost', debit: gross, credit: 0 }, { account: 'counter', debit: 0, credit: gross }] });
      }
      if (depStartDate && period === depStartMonth) {
        seg = newSegment(asset.method, asset.dbFactor ?? 2, asset.switchToStraightLine !== false, remaining, 0, 0, asset.unitsTotal ?? 0);
        restartSyd(asset.method);
      }
    }
    // an asset that becomes available for use after the acquisition month: the segment starts when depreciation does
    if (depStartMonth && period === depStartMonth && period !== startMonth) {
      status = status === 'under-construction' ? 'in-use' : status;
      seg = newSegment(asset.method, asset.dbFactor ?? 2, asset.switchToStraightLine !== false, remaining, 0, 0, asset.unitsTotal ?? 0);
      restartSyd(asset.method);
    }

    // events that stop depreciation inside the month
    const stop = evs.find((e) => e.kind === 'disposal' || e.kind === 'held-for-sale');
    const units = evs.filter((e): e is Extract<AssetEvent, { kind: 'usage' }> => e.kind === 'usage').reduce((s, e) => s + e.units, 0);

    // ── depreciation for the month ──
    let dep = 0;
    const inServiceAtStart = status === 'in-use' && depStartMonth !== undefined && period >= depStartMonth && asset.method !== 'none' && gross > 0;
    if (inServiceAtStart) {
      const startFrac = period === depStartMonth ? startFraction(asset.convention, depStartDate as string) : 1;
      const endFrac = stop ? stopFraction(asset.convention, stop.date) : 1;
      let w: number;
      if (period === depStartMonth && stop) {
        if (asset.convention === 'daily') {
          const dim = daysIn(Number(period.slice(0, 4)), Number(period.slice(5, 7)));
          w = Math.max(0, (Number(stop.date.slice(8, 10)) - Number((depStartDate as string).slice(8, 10)) + 1) / dim);
        } else w = Math.min(startFrac, endFrac);
      } else w = Math.min(startFrac, endFrac);
      dep = monthlyDepreciation(seg, gross - accum, residual, remaining, w, units, usedUnits);
      dep = r2(dep);
      remaining = Math.max(0, remaining - w);
      seg.sydConsumed += w;
      usedUnits += units;
    }
    accum = r2(accum + dep);
    row.depreciation = dep;
    row.depreciationOnCost = shadows?.cost?.get(period) ?? dep;

    // ── surplus transfer (IAS 16.41) ──
    if (surplus > EPS && opts.transferSurplus !== false) {
      const t = r2(Math.min(surplus, Math.max(0, dep - row.depreciationOnCost)));
      if (t > 0) { surplus = r2(surplus - t); row.surplusTransfer = t; }
    }

    // ── events, in date order, at the end of the month ──
    for (const ev of evs) {
      const carrying = r2(gross - accum);
      switch (ev.kind) {
        case 'usage': break;
        case 'improvement': {
          gross = r2(gross + ev.amount);
          row.additions += ev.amount;
          if (ev.extendsLifeMonths && ev.extendsLifeMonths > 0) remaining += ev.extendsLifeMonths;
          restartSyd(seg.method);
          postings.push({ key: ev.id, assetId: asset.id, date: ev.date, memo: `Improvement to ${asset.name}`, lines: [{ account: 'cost', debit: r2(ev.amount), credit: 0 }, { account: 'counter', debit: 0, credit: r2(ev.amount) }] });
          break;
        }
        case 'estimate-change': {
          if (ev.residual !== undefined) residual = ev.residual;
          if (ev.remainingLifeMonths !== undefined) remaining = ev.remainingLifeMonths;
          const method = ev.method ?? seg.method;
          seg = newSegment(method, ev.dbFactor ?? seg.dbFactor, seg.switchSl, remaining, 0, 0, ev.unitsTotal ?? seg.unitsTotal);
          restartSyd(method);
          break;
        }
        case 'revaluation': {
          if (asset.model !== 'revaluation' || !policy.allowsRevaluation) break; // validateAsset already says why

          if (status === 'disposed') break;
          const delta = r2(ev.fairValue - carrying);
          if (Math.abs(delta) < EPS) { info.push(`Revaluation on ${ev.date}: fair value equals the carrying amount, nothing to book.`); break; }
          const lines: PostingLine[] = [];
          let newGross: number;
          let newAccum: number;
          if ((asset.revaluationMethod ?? 'eliminate') === 'proportional' && carrying > 0) {
            newGross = r2(gross * (ev.fairValue / carrying));
            newAccum = r2(newGross - ev.fairValue);
          } else { newGross = r2(ev.fairValue); newAccum = 0; }
          const dGross = r2(newGross - gross);
          const dAccum = r2(newAccum - accum);
          if (dGross > 0) lines.push({ account: 'cost', debit: dGross, credit: 0 }); else if (dGross < 0) lines.push({ account: 'cost', debit: 0, credit: -dGross });
          if (dAccum > 0) lines.push({ account: 'accumulated', debit: 0, credit: dAccum }); else if (dAccum < 0) lines.push({ account: 'accumulated', debit: -dAccum, credit: 0 });
          if (delta > 0) {
            const toPl = r2(Math.min(plLossCum, delta));
            const toOci = r2(delta - toPl);
            if (toPl > 0) lines.push({ account: 'reversal', debit: 0, credit: toPl });
            if (toOci > 0) lines.push({ account: 'surplus', debit: 0, credit: toOci });
            plLossCum = r2(plLossCum - toPl);
            surplus = r2(surplus + toOci);
            row.revaluationOci += toOci;
            row.revaluationPl += toPl;
          } else {
            const dec = -delta;
            const fromSurplus = r2(Math.min(surplus, dec));
            const toPl = r2(dec - fromSurplus);
            if (fromSurplus > 0) lines.push({ account: 'surplus', debit: fromSurplus, credit: 0 });
            if (toPl > 0) lines.push({ account: 'impairment', debit: toPl, credit: 0 });
            surplus = r2(surplus - fromSurplus);
            plLossCum = r2(plLossCum + toPl);
            row.revaluationOci -= fromSurplus;
            row.revaluationPl -= toPl;
          }
          gross = newGross;
          accum = newAccum;
          restartSyd(seg.method);
          postings.push({ key: ev.id, assetId: asset.id, date: ev.date, memo: `Revaluation of ${asset.name} to fair value ${ev.fairValue.toLocaleString('en')}`, lines: balance(lines) });
          break;
        }
        case 'impairment': {
          if (status === 'disposed') break;
          if (policy.impairmentTest === 'recoverability-then-fair-value' && typeof ev.undiscountedCashFlows === 'number' && ev.undiscountedCashFlows >= carrying) {
            info.push(`Impairment test on ${ev.date}: undiscounted cash flows cover the carrying amount, so no loss is recognised.`);
            break;
          }
          const loss = r2(carrying - ev.recoverable);
          if (loss <= EPS) { info.push(`Impairment test on ${ev.date}: the recoverable amount is not below the carrying amount, so no loss is recognised.`); break; }
          const lines = impairmentLines(asset, loss, surplus);
          if (asset.model === 'revaluation') { // IAS 36.60: a loss on a revalued asset is a revaluation decrease
            const fromSurplus = Math.min(surplus, loss);
            surplus = r2(surplus - fromSurplus);
            plLossCum = r2(plLossCum + (loss - fromSurplus));
            row.revaluationOci -= fromSurplus;
            row.revaluationPl -= r2(loss - fromSurplus);
          } else {
            impairmentCum = r2(impairmentCum + loss);
            row.impairmentLoss += loss;
          }
          accum = r2(accum + loss);
          restartSyd(seg.method);
          postings.push({ key: ev.id, assetId: asset.id, date: ev.date, memo: `Impairment of ${asset.name}`, lines });
          break;
        }
        case 'impairment-reversal': {
          if (status === 'disposed' || asset.model === 'revaluation' || !policy.allowsImpairmentReversal) break;
          const would = shadows?.noImpairment?.get(period);
          const cap = would === undefined ? Infinity : r2(would - carrying);
          const rev = r2(Math.min(ev.recoverable - carrying, impairmentCum, cap));
          if (rev <= EPS) { info.push(`Reversal on ${ev.date}: nothing can be reversed (the recoverable amount is not above the carrying amount, there is no earlier impairment, or the carrying amount would exceed what it would have been without the impairment).`); break; }
          accum = r2(accum - rev);
          impairmentCum = r2(impairmentCum - rev);
          row.impairmentReversal += rev;
          restartSyd(seg.method);
          postings.push({ key: ev.id, assetId: asset.id, date: ev.date, memo: `Reversal of impairment on ${asset.name}`, lines: [{ account: 'accumulated', debit: rev, credit: 0 }, { account: 'reversal', debit: 0, credit: rev }] });
          break;
        }
        case 'held-for-sale': {
          if (status === 'disposed') break;
          const loss = r2(carrying - ev.fairValueLessCosts);
          if (loss > EPS) {
            const lines = impairmentLines(asset, loss, surplus);
            if (asset.model === 'revaluation') {
              const fromSurplus = Math.min(surplus, loss);
              surplus = r2(surplus - fromSurplus);
              plLossCum = r2(plLossCum + (loss - fromSurplus));
              row.revaluationOci -= fromSurplus;
              row.revaluationPl -= r2(loss - fromSurplus);
            } else { impairmentCum = r2(impairmentCum + loss); row.impairmentLoss += loss; }
            accum = r2(accum + loss);
            postings.push({ key: ev.id, assetId: asset.id, date: ev.date, memo: `Write-down of ${asset.name} to fair value less costs to sell`, lines });
          }
          status = 'held-for-sale';
          break;
        }
        case 'reclassify-in-use':
          if (status === 'held-for-sale') status = 'in-use';
          break;
        case 'disposal': {
          if (status === 'disposed') break;
          const proceeds = r2(ev.proceeds - (ev.costs ?? 0));
          const gainLoss = r2(proceeds - carrying);
          const lines: PostingLine[] = [];
          if (proceeds > 0) lines.push({ account: 'counter', debit: proceeds, credit: 0 });
          if (accum > 0) lines.push({ account: 'accumulated', debit: accum, credit: 0 });
          if (gross > 0) lines.push({ account: 'cost', debit: 0, credit: gross });
          if (gainLoss > EPS) lines.push({ account: 'gainOnDisposal', debit: 0, credit: gainLoss });
          else if (gainLoss < -EPS) lines.push({ account: 'lossOnDisposal', debit: -gainLoss, credit: 0 });
          if (surplus > EPS) { // the surplus is moved straight to retained earnings, never through profit or loss (IAS 16.41)
            lines.push({ account: 'surplus', debit: surplus, credit: 0 }, { account: 'retained', debit: 0, credit: surplus });
          }
          postings.push({ key: ev.id, assetId: asset.id, date: ev.date, memo: `Disposal of ${asset.name}`, lines: balance(lines) });
          row.disposalGross += gross;
          row.disposalAccum += accum;
          gross = 0; accum = 0; surplus = 0; status = 'disposed';
          break;
        }
      }
    }

    row.grossClose = gross;
    row.accumClose = accum;
    row.surplusClose = surplus;
    row.status = status;
    months.push(row);
    if (status === 'disposed') break;
  }

  issues.unshift(...validateAsset(asset, policy));
  return { months, postings, issues: [...new Set(issues)], info };
}

function newSegment(method: DepreciationMethod, dbFactor: number, switchSl: boolean, remaining: number, sydBase: number, sydConsumed: number, unitsTotal: number): Segment {
  const years = remaining / 12;
  return { method, dbFactor, dbRate: years > 0 ? dbFactor / years : 0, switchSl, sydBase, sydConsumed, sydYears: Math.max(1, Math.ceil(remaining / 12)), unitsTotal };
}

/** The charge for one month of `w` months in service (w is 1 for a full month). */
function monthlyDepreciation(seg: Segment, carrying: number, residual: number, remaining: number, w: number, units: number, usedUnits: number): number {
  const depreciable = Math.max(0, carrying - residual);
  if (depreciable <= 0 || w <= 0) return 0;
  switch (seg.method) {
    case 'none': return 0;
    case 'straight-line': return remaining <= w + 1e-9 ? depreciable : depreciable * (w / remaining);
    case 'declining-balance': {
      if (remaining <= w + 1e-9) return depreciable; // the last month takes whatever is left
      const sl = depreciable * (w / remaining);
      const db = carrying * (seg.dbRate / 12) * w;
      return Math.min(depreciable, seg.switchSl ? Math.max(db, sl) : db);
    }
    case 'sum-of-years': {
      if (remaining <= w + 1e-9) return depreciable;
      const n = seg.sydYears;
      const k = Math.min(n, Math.floor(seg.sydConsumed / 12) + 1);
      const yearDep = seg.sydBase * (n - k + 1) / ((n * (n + 1)) / 2);
      return Math.min(depreciable, (yearDep / 12) * w);
    }
    case 'units-of-production': {
      const left = Math.max(0, seg.unitsTotal - usedUnits);
      if (left <= 0) return depreciable;
      return Math.min(depreciable, depreciable * Math.min(1, units / left));
    }
  }
}

/** Debit the loss account (after any surplus on a revalued asset), credit accumulated depreciation and impairment. */
function impairmentLines(asset: FixedAsset, loss: number, surplus: number): PostingLine[] {
  const lines: PostingLine[] = [];
  if (asset.model === 'revaluation') {
    const fromSurplus = r2(Math.min(surplus, loss));
    if (fromSurplus > 0) lines.push({ account: 'surplus', debit: fromSurplus, credit: 0 });
    if (loss - fromSurplus > EPS) lines.push({ account: 'impairment', debit: r2(loss - fromSurplus), credit: 0 });
  } else lines.push({ account: 'impairment', debit: loss, credit: 0 });
  lines.push({ account: 'accumulated', debit: 0, credit: loss });
  return lines;
}

/** Rounds away any one-cent difference caused by rounding the legs separately, on the largest line. */
function balance(lines: PostingLine[]): PostingLine[] {
  const d = r2(lines.reduce((s, l) => s + l.debit, 0));
  const c = r2(lines.reduce((s, l) => s + l.credit, 0));
  const diff = r2(d - c);
  if (Math.abs(diff) < EPS || Math.abs(diff) > 0.05 || lines.length === 0) return lines;
  const out = lines.map((l) => ({ ...l }));
  const target = out.reduce((best, l) => (Math.max(l.debit, l.credit) > Math.max(best.debit, best.credit) ? l : best), out[0]);
  if (diff > 0) { if (target.credit > 0) target.credit = r2(target.credit + diff); else target.debit = r2(target.debit - diff); }
  else if (target.debit > 0) target.debit = r2(target.debit - diff); else target.credit = r2(target.credit + diff);
  return out;
}

/** Simulates one asset from acquisition through `until`. */
export function simulateAsset(asset: FixedAsset, policy: AssetPolicy, until: string, opts: SimOptions = {}): Simulation {
  const revalued = asset.model === 'revaluation' && asset.events.some((e) => e.kind === 'revaluation');
  const hasReversal = asset.events.some((e) => e.kind === 'impairment-reversal');
  // two comparison runs, only when they are needed: depreciation at historical cost, and the carrying amount with no impairment
  let cost: Map<string, number> | undefined;
  let noImpairment: Map<string, number> | undefined;
  if (revalued) {
    cost = new Map(run(asset, policy, until, opts, { skipRevaluations: true }).months.map((m) => [m.period, m.depreciation]));
  }
  if (hasReversal) {
    noImpairment = new Map(run(asset, policy, until, opts, { skipImpairments: true }).months.map((m) => [m.period, r2(m.grossClose - m.accumClose)]));
  }
  return run(asset, policy, until, opts, {}, { cost, noImpairment });
}

// ── reading a simulation ──────────────────────────────────────────────────────────────────────────────────────────────

export interface AssetPosition {
  gross: number;
  accumulated: number;
  carrying: number;
  surplus: number;
  status: AssetStatus;
}

export function positionAt(sim: Simulation, period: string): AssetPosition {
  let last: MonthRow | undefined;
  for (const m of sim.months) { if (m.period <= period) last = m; else break; }
  if (!last) return { gross: 0, accumulated: 0, carrying: 0, surplus: 0, status: 'in-use' };
  const gross = last.grossClose;
  return { gross, accumulated: last.accumClose, carrying: r2(gross - last.accumClose), surplus: last.surplusClose, status: last.status };
}

export function cumulativeDepreciation(sim: Simulation, through: string): number {
  return r2(sim.months.filter((m) => m.period <= through).reduce((s, m) => s + m.depreciation, 0));
}

/** The remaining months of depreciation from `period` on, as a forecast schedule (carrying amount at each month end). */
export function forecast(asset: FixedAsset, policy: AssetPolicy, fromPeriod: string, months: number, opts: SimOptions = {}): MonthRow[] {
  let end = fromPeriod;
  for (let i = 0; i < months; i++) end = nextMonth(end);
  return simulateAsset(asset, policy, end, opts).months.filter((m) => m.period >= fromPeriod);
}

// ── the roll-forward (IAS 16.73(e)) ───────────────────────────────────────────────────────────────────────────────────

export interface RollForward {
  from: string;
  to: string;
  costOpening: number;
  additions: number;
  disposals: number;
  /** Net effect of revaluations on the carrying amount (positive = increase). */
  revaluations: number;
  costClosing: number;
  accumOpening: number;
  depreciation: number;
  impairment: number;
  impairmentReversal: number;
  accumDisposals: number;
  accumClosing: number;
  carryingOpening: number;
  carryingClosing: number;
  surplusClosing: number;
}

/** One row for a set of simulations over [from, to] (two 'YYYY-MM' periods, inclusive). */
export function rollForward(sims: Simulation[], from: string, to: string): RollForward {
  const rf: RollForward = {
    from, to, costOpening: 0, additions: 0, disposals: 0, revaluations: 0, costClosing: 0, accumOpening: 0, depreciation: 0, impairment: 0, impairmentReversal: 0,
    accumDisposals: 0, accumClosing: 0, carryingOpening: 0, carryingClosing: 0, surplusClosing: 0,
  };
  for (const sim of sims) {
    const inRange = sim.months.filter((m) => m.period >= from && m.period <= to);
    const before = sim.months.filter((m) => m.period < from);
    const open = before[before.length - 1];
    const gOpen = open ? open.grossClose : 0;
    const aOpen = open ? open.accumClose : 0;
    rf.costOpening += gOpen;
    rf.accumOpening += aOpen;
    for (const m of inRange) {
      rf.additions += m.additions;
      rf.disposals += m.disposalGross;
      rf.depreciation += m.depreciation;
      rf.impairment += m.impairmentLoss;
      rf.impairmentReversal += m.impairmentReversal;
      rf.accumDisposals += m.disposalAccum;
      // the net effect of revaluations on the carrying amount: increases to equity, and decreases or reversals through profit or loss.
      // (An impairment of a revalued asset is a revaluation decrease, IAS 36.60, so it is counted here and not under impairment.)
      rf.revaluations += m.revaluationOci + m.revaluationPl;
    }
    const close = inRange.length ? inRange[inRange.length - 1] : open;
    rf.costClosing += close ? close.grossClose : 0;
    rf.accumClosing += close ? close.accumClose : 0;
    rf.surplusClosing += close ? close.surplusClose : 0;
  }
  for (const k of Object.keys(rf) as (keyof RollForward)[]) if (typeof rf[k] === 'number') (rf[k] as number) = r2(rf[k] as number);
  rf.carryingOpening = r2(rf.costOpening - rf.accumOpening);
  rf.carryingClosing = r2(rf.costClosing - rf.accumClosing);
  return rf;
}
