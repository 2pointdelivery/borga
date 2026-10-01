import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateAsset, validateAsset, positionAt, cumulativeDepreciation, forecast, rollForward, nextMonth, monthEnd, type FixedAsset, type AssetEvent, type Posting } from './borga/fixed-assets';
import { assetPolicyFor, assetPolicyForFramework, ASSET_ACCOUNTS, categoryOf, ASSET_CATEGORIES } from './borga/fixed-asset-standards';

const IFRS = assetPolicyForFramework('IFRS');
const GAAP = assetPolicyForFramework('US-GAAP');
const ASPE = assetPolicyForFramework('ASPE');

const asset = (over: Partial<FixedAsset> = {}): FixedAsset => ({
  id: 'a1', name: 'Press', category: 'machinery', acquiredOn: '2026-01-01', cost: 12_000, residual: 0, usefulLifeMonths: 12, method: 'straight-line',
  convention: 'daily', model: 'cost', glMode: 'register-posts', events: [], ...over,
});
let n = 0;
type NewEvent<E = AssetEvent> = E extends AssetEvent ? Omit<E, 'id'> & { id?: string } : never;
const ev = (e: NewEvent): AssetEvent => ({ id: e.id ?? `e${++n}`, ...e }) as AssetEvent;
const dep = (a: FixedAsset, policy = IFRS, until = '2030-12') => simulateAsset(a, policy, until).months.map((m) => m.depreciation);
const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;
const post = (p: Posting[], key: string) => p.find((x) => x.key === key)!;
const amt = (p: Posting, account: string) => p.lines.filter((l) => l.account === account).reduce((s, l) => s + l.debit - l.credit, 0);
const balanced = (p: Posting) => Math.abs(p.lines.reduce((s, l) => s + l.debit - l.credit, 0)) < 0.005;

// ── months and the standards table ────────────────────────────────────────────────────────────────────────────────────

test('month helpers', () => {
  assert.equal(nextMonth('2026-12'), '2027-01');
  assert.equal(nextMonth('2026-01'), '2026-02');
  assert.equal(monthEnd('2028-02'), '2028-02-29');
  assert.equal(monthEnd('2026-04'), '2026-04-30');
});

test('each country gets its framework\'s rules: IFRS may revalue and reverse, US GAAP and ASPE may not', () => {
  assert.equal(assetPolicyFor('Ghana').framework, 'IFRS');
  assert.equal(assetPolicyFor('Denmark').framework, 'IFRS');
  assert.equal(assetPolicyFor('United States').framework, 'US-GAAP');
  assert.equal(assetPolicyFor('Canada').framework, 'ASPE');
  assert.equal(assetPolicyFor('France').framework, 'IFRS', 'unknown countries use IFRS, as the rest of the app does');
  assert.equal(IFRS.allowsRevaluation, true);
  assert.equal(IFRS.allowsImpairmentReversal, true);
  assert.equal(GAAP.allowsRevaluation, false);
  assert.equal(GAAP.allowsImpairmentReversal, false);
  assert.equal(ASPE.allowsRevaluation, false);
  assert.equal(IFRS.impairmentTest, 'recoverable-amount');
  assert.equal(GAAP.impairmentTest, 'recoverability-then-fair-value');
  assert.ok(ASSET_CATEGORIES.every((c) => categoryOf(c.id).id === c.id));
  assert.equal(categoryOf('nonsense').id, 'other');
});

// ── straight-line and the conventions ─────────────────────────────────────────────────────────────────────────────────

test('straight-line: equal charges, ending exactly at the residual value', () => {
  const d = dep(asset());
  assert.deepEqual(d.slice(0, 12), Array(12).fill(1000));
  assert.equal(sum(d), 12_000);
  assert.equal(d.length >= 12, true);
  const r = asset({ cost: 10_000, residual: 1000, usefulLifeMonths: 60 });
  const sim = simulateAsset(r, IFRS, '2031-06');
  assert.equal(sim.months[0].depreciation, 150);
  assert.equal(positionAt(sim, '2031-06').carrying, 1000, 'the residual value is never depreciated');
  assert.equal(positionAt(sim, '2026-12').carrying, 10_000 - 12 * 150);
});

test('daily convention: a part month at the start, then whole months, and the total is still the depreciable amount', () => {
  const d = dep(asset({ acquiredOn: '2026-01-16' }), IFRS, '2027-06');
  assert.equal(d[0], 516.13, '16 of 31 days of January');
  assert.equal(d[1], 1000);
  assert.equal(sum(d), 12_000);
  assert.equal(d.filter((x) => x > 0).length, 13, 'one part month at each end');
});

test('conventions: full month, mid-month and next-month', () => {
  assert.equal(dep(asset({ acquiredOn: '2026-01-31', convention: 'full-month' }))[0], 1000);
  assert.equal(dep(asset({ acquiredOn: '2026-01-05', convention: 'next-month' }))[0], 0);
  assert.equal(dep(asset({ acquiredOn: '2026-01-05', convention: 'next-month' }))[1], 1000);
  const mid = dep(asset({ acquiredOn: '2026-01-05', convention: 'mid-month' }));
  assert.equal(mid[0], 500);
  assert.equal(sum(mid), 12_000);
});

test('land and assets under construction are not depreciated until they are available for use', () => {
  assert.equal(sum(dep(asset({ method: 'none', category: 'land', usefulLifeMonths: 0 }), IFRS, '2030-12')), 0);
  const cip = asset({ category: 'construction', method: 'straight-line' });
  assert.equal(sum(dep(cip, IFRS, '2027-12')), 0, 'no available-for-use date, no depreciation');
  assert.equal(simulateAsset(cip, IFRS, '2026-03').months[0].status, 'under-construction');
  const live = asset({ category: 'construction', availableFrom: '2026-04-01' });
  const d = dep(live, IFRS, '2027-06');
  assert.deepEqual(d.slice(0, 5), [0, 0, 0, 1000, 1000]);
  assert.equal(sum(d), 12_000);
});

// ── the other methods ─────────────────────────────────────────────────────────────────────────────────────────────────

test('declining balance: double-declining charge first, switches to straight-line, never goes below the residual', () => {
  const a = asset({ cost: 10_000, usefulLifeMonths: 60, method: 'declining-balance', dbFactor: 2 });
  const d = dep(a, IFRS, '2031-06');
  assert.equal(d[0], 333.33, '10,000 x 40% / 12');
  assert.equal(d[1], 322.22);
  assert.ok(d[0] > d[1] && d[1] > d[2], 'charges fall');
  assert.equal(sum(d), 10_000);
  assert.equal(positionAt(simulateAsset(a, IFRS, '2031-06'), '2031-06').carrying, 0);
  const withResidual = asset({ cost: 10_000, residual: 2000, usefulLifeMonths: 60, method: 'declining-balance', dbFactor: 2 });
  assert.equal(positionAt(simulateAsset(withResidual, IFRS, '2031-12'), '2031-12').carrying, 2000);
  const sim = simulateAsset(withResidual, IFRS, '2031-12');
  assert.ok(sim.months.every((m) => m.grossClose - m.accumClose >= 2000 - 0.005), 'never below residual');
  // 150% declining balance is gentler than 200%
  const gentle = asset({ cost: 10_000, usefulLifeMonths: 60, method: 'declining-balance', dbFactor: 1.5 });
  assert.equal(dep(gentle)[0], 250, '10,000 x 30% / 12');
});

test('sum of the years\' digits: 5/15 of the base in year one, 4/15 in year two, and so on', () => {
  const a = asset({ cost: 18_000, usefulLifeMonths: 60, method: 'sum-of-years' });
  const d = dep(a, IFRS, '2031-06');
  assert.equal(sum(d.slice(0, 12)), 6000);
  assert.equal(sum(d.slice(12, 24)), 4800);
  assert.equal(sum(d.slice(24, 36)), 3600);
  assert.equal(sum(d.slice(36, 48)), 2400);
  assert.equal(sum(d.slice(48, 60)), 1200);
  assert.equal(sum(d), 18_000);
});

test('units of production: the charge follows the units made, and never exceeds what is left', () => {
  const a = asset({ cost: 100_000, residual: 10_000, usefulLifeMonths: 120, method: 'units-of-production', unitsTotal: 90_000, events: [
    ev({ kind: 'usage', date: '2026-01-20', units: 1000 }), ev({ kind: 'usage', date: '2026-02-10', units: 2000 }), ev({ kind: 'usage', date: '2026-04-10', units: 500 }),
  ] });
  const d = dep(a, IFRS, '2026-06');
  assert.deepEqual(d.slice(0, 4), [1000, 2000, 0, 500], 'a month with no usage has no charge');
  const over = asset({ cost: 100_000, residual: 10_000, method: 'units-of-production', unitsTotal: 1000, events: [ev({ kind: 'usage', date: '2026-01-20', units: 5000 })] });
  assert.equal(dep(over, IFRS, '2026-03')[0], 90_000, 'capped at the depreciable amount');
});

// ── changes to the estimates ──────────────────────────────────────────────────────────────────────────────────────────

test('a capital improvement raises the base and can extend the life, from then on only', () => {
  const a = asset({ events: [ev({ kind: 'improvement', date: '2026-06-30', amount: 3000, extendsLifeMonths: 6 })] });
  const d = dep(a, IFRS, '2027-12');
  assert.deepEqual(d.slice(0, 6), Array(6).fill(1000), 'the first six months are untouched');
  assert.equal(d[6], 750, '(6,000 + 3,000) over 12 remaining months');
  assert.equal(sum(d), 15_000);
  const sim = simulateAsset(a, IFRS, '2026-06');
  assert.equal(post(sim.postings, a.events[0].id).lines.find((l) => l.account === 'cost')!.debit, 3000);
});

test('a change in estimate applies going forward, never to past months', () => {
  const a = asset({ events: [ev({ kind: 'estimate-change', date: '2026-06-30', remainingLifeMonths: 18 })] });
  const d = dep(a, IFRS, '2028-12');
  assert.deepEqual(d.slice(0, 6), Array(6).fill(1000));
  assert.equal(d[6], 333.33, '6,000 carrying amount over 18 months');
  assert.equal(sum(d), 12_000);
  const residualChange = asset({ events: [ev({ kind: 'estimate-change', date: '2026-06-30', residual: 3000 })] });
  assert.equal(dep(residualChange)[6], 500, '(6,000 - 3,000) over 6 remaining months');
});

// ── revaluation ───────────────────────────────────────────────────────────────────────────────────────────────────────

const revalued = (events: AssetEvent[], over: Partial<FixedAsset> = {}) => asset({ cost: 120_000, usefulLifeMonths: 120, model: 'revaluation', events, ...over });

test('IFRS revaluation up: the increase goes to the revaluation surplus, accumulated depreciation is eliminated, and the entry balances', () => {
  const e = ev({ kind: 'revaluation', date: '2027-12-31', fairValue: 144_000 });
  const a = revalued([e]);
  const sim = simulateAsset(a, IFRS, '2028-12', { transferSurplus: false });
  const p = post(sim.postings, e.id);
  assert.ok(balanced(p));
  assert.equal(amt(p, 'cost'), 24_000, 'gross goes from 120,000 to 144,000');
  assert.equal(amt(p, 'accumulated'), 24_000, 'the 24,000 accumulated so far is eliminated');
  assert.equal(amt(p, 'surplus'), -48_000, 'carrying amount 96,000 up to 144,000');
  assert.equal(positionAt(sim, '2027-12').carrying, 144_000);
  assert.equal(positionAt(sim, '2027-12').accumulated, 0);
  assert.equal(positionAt(sim, '2027-12').surplus, 48_000);
  assert.equal(sim.months[24].depreciation, 1500, 'depreciation now follows the revalued amount over the 96 months left');
});

test('IFRS revaluation up, proportional method: gross and accumulated depreciation are both scaled', () => {
  const e = ev({ kind: 'revaluation', date: '2027-12-31', fairValue: 144_000 });
  const a = revalued([e], { revaluationMethod: 'proportional' });
  const sim = simulateAsset(a, IFRS, '2027-12');
  const p = post(sim.postings, e.id);
  assert.ok(balanced(p));
  const pos = positionAt(sim, '2027-12');
  assert.equal(pos.carrying, 144_000);
  assert.equal(pos.gross, 180_000, '120,000 x (144,000 / 96,000)');
  assert.equal(pos.accumulated, 36_000);
});

test('surplus is moved to retained earnings as the asset is used (IAS 16.41), and in full when the asset is sold', () => {
  const e = ev({ kind: 'revaluation', date: '2027-12-31', fairValue: 144_000 });
  const a = revalued([e]);
  const sim = simulateAsset(a, IFRS, '2028-12');
  const jan = sim.months.find((m) => m.period === '2028-01')!;
  assert.equal(jan.depreciation, 1500);
  assert.equal(jan.depreciationOnCost, 1000, 'what it would have been on the original cost');
  assert.equal(jan.surplusTransfer, 500);
  assert.equal(positionAt(sim, '2028-12').surplus, 42_000, '48,000 less twelve transfers of 500');
  const sold = revalued([e, ev({ kind: 'disposal', date: '2028-06-30', proceeds: 140_000 })]);
  const s2 = simulateAsset(sold, IFRS, '2028-12');
  const d = s2.postings.find((x) => x.key === sold.events[1].id)!;
  assert.ok(balanced(d));
  assert.equal(amt(d, 'surplus'), 45_000, 'the 3,000 already transferred leaves 45,000, which goes straight to retained earnings');
  assert.equal(amt(d, 'retained'), -45_000);
  assert.equal(amt(d, 'gainOnDisposal'), -(140_000 - 135_000), 'proceeds above the carrying amount of 135,000: the surplus is not part of the gain');
});

test('a revaluation decrease uses up the asset surplus first, the rest is a loss; a later increase reverses that loss through profit first', () => {
  const up = ev({ kind: 'revaluation', date: '2027-12-31', fairValue: 144_000 });
  const down = ev({ kind: 'revaluation', date: '2028-12-31', fairValue: 71_400 });
  const up2 = ev({ kind: 'revaluation', date: '2029-12-31', fairValue: 90_000 });
  const a = revalued([up, down, up2]);
  const sim = simulateAsset(a, IFRS, '2029-12', { transferSurplus: false });
  const pd = post(sim.postings, down.id);
  assert.ok(balanced(pd));
  assert.equal(positionAt(sim, '2028-11').carrying, 144_000 - 11 * 1500);
  assert.equal(amt(pd, 'surplus'), 48_000, 'the whole 48,000 surplus is used first');
  assert.equal(amt(pd, 'impairment'), 6600, 'carrying amount 126,000 down to 71,400 is 54,600: 6,600 beyond the surplus is a loss');
  const pu = post(sim.postings, up2.id);
  assert.ok(balanced(pu));
  assert.equal(positionAt(sim, '2029-11').carrying, 71_400 - 11 * 850);
  assert.equal(amt(pu, 'reversal'), -6600, 'the earlier loss is reversed through profit first');
  assert.equal(amt(pu, 'surplus'), -22_200, 'only the rest (90,000 less 61,200 less 6,600) goes to the surplus');
});

test('revaluation is refused where the framework forbids it', () => {
  const e = ev({ kind: 'revaluation', date: '2027-12-31', fairValue: 120_000 });
  const a = revalued([e]);
  for (const policy of [GAAP, ASPE]) {
    const sim = simulateAsset(a, policy, '2028-12');
    assert.ok(sim.issues.some((i) => /does not allow the revaluation model/.test(i)), policy.label);
    assert.ok(sim.issues.some((i) => /not allowed under/.test(i)));
    assert.equal(sim.postings.some((p) => p.key === e.id), false, 'nothing is booked');
    assert.equal(positionAt(sim, '2028-12').carrying < 100_000, true, 'the asset stays at cost');
  }
  assert.deepEqual(validateAsset(revalued([e]), IFRS), []);
  assert.ok(validateAsset(asset({ events: [e] }), IFRS).some((i) => /needs the asset to use the revaluation model/.test(i)));
});

// ── impairment ────────────────────────────────────────────────────────────────────────────────────────────────────────

const imp = (over: Partial<FixedAsset> = {}) => asset({ cost: 60_000, usefulLifeMonths: 60, ...over });

test('IFRS impairment: loss is the carrying amount above the recoverable amount, and depreciation falls from then on', () => {
  const e = ev({ kind: 'impairment', date: '2026-12-31', recoverable: 36_000 });
  const sim = simulateAsset(imp({ events: [e] }), IFRS, '2027-12');
  const p = post(sim.postings, e.id);
  assert.ok(balanced(p));
  assert.equal(amt(p, 'impairment'), 12_000, 'carrying amount 48,000 against 36,000 recoverable');
  assert.equal(amt(p, 'accumulated'), -12_000);
  assert.equal(sim.months[11].depreciation, 1000, 'December is charged on the old basis');
  assert.equal(sim.months[12].depreciation, 750, '36,000 over the 48 months left');
  assert.equal(sim.months.find((m) => m.period === '2026-12')!.impairmentLoss, 12_000);
});

test('IFRS impairment reversal is capped at what the carrying amount would have been without the impairment', () => {
  const i = ev({ kind: 'impairment', date: '2026-12-31', recoverable: 36_000 });
  const r = ev({ kind: 'impairment-reversal', date: '2027-12-31', recoverable: 48_000 });
  const sim = simulateAsset(imp({ events: [i, r] }), IFRS, '2027-12');
  const p = post(sim.postings, r.id);
  assert.ok(balanced(p));
  // carrying 27,000 now; without the impairment it would be 36,000, so only 9,000 may come back (not 12,000, not 21,000)
  assert.equal(amt(p, 'reversal'), -9000);
  assert.equal(positionAt(sim, '2027-12').carrying, 36_000);
  const nothing = simulateAsset(imp({ events: [ev({ kind: 'impairment-reversal', date: '2027-12-31', recoverable: 99_999 })] }), IFRS, '2027-12');
  assert.equal(nothing.postings.length, 1, 'only the acquisition: there was no impairment to reverse');
});

test('US GAAP and ASPE: no write-down while undiscounted cash flows cover the carrying amount, then down to fair value, and never reversed', () => {
  for (const policy of [GAAP, ASPE]) {
    const covered = ev({ kind: 'impairment', date: '2026-12-31', recoverable: 36_000, undiscountedCashFlows: 55_000 });
    const s1 = simulateAsset(imp({ events: [covered] }), policy, '2027-03');
    assert.equal(s1.postings.some((p) => p.key === covered.id), false, 'recoverable, so no loss');
    assert.ok(s1.info.some((i) => /cash flows cover/.test(i)));
    const short = ev({ kind: 'impairment', date: '2026-12-31', recoverable: 36_000, undiscountedCashFlows: 45_000 });
    const s2 = simulateAsset(imp({ events: [short] }), policy, '2027-03');
    assert.equal(amt(post(s2.postings, short.id), 'impairment'), 12_000);
    const noTest = ev({ kind: 'impairment', date: '2026-12-31', recoverable: 36_000 });
    assert.ok(simulateAsset(imp({ events: [noTest] }), policy, '2027-03').issues.some((i) => /first tests recoverability/.test(i)));
    const rev = ev({ kind: 'impairment-reversal', date: '2027-12-31', recoverable: 48_000 });
    assert.ok(simulateAsset(imp({ events: [short, rev] }), policy, '2027-12').issues.some((i) => /not allowed under/.test(i)), 'a write-down is not reversed');
  }
});

test('an impairment on a revalued asset is a revaluation decrease: it uses the surplus first (IAS 36.60)', () => {
  const up = ev({ kind: 'revaluation', date: '2027-12-31', fairValue: 120_000 });
  const i = ev({ kind: 'impairment', date: '2028-03-31', recoverable: 100_000 });
  const sim = simulateAsset(revalued([up, i]), IFRS, '2028-03', { transferSurplus: false });
  const p = post(sim.postings, i.id);
  assert.ok(balanced(p));
  assert.equal(amt(p, 'surplus') > 0, true, 'debits the surplus');
  assert.equal(amt(p, 'impairment'), 0, 'nothing through profit while the surplus lasts');
});

// ── held for sale and disposal ────────────────────────────────────────────────────────────────────────────────────────

test('held for sale: written down to fair value less costs to sell and depreciation stops', () => {
  const h = ev({ kind: 'held-for-sale', date: '2026-06-30', fairValueLessCosts: 4000 });
  const sim = simulateAsset(asset({ events: [h] }), IFRS, '2027-06');
  assert.equal(amt(post(sim.postings, h.id), 'impairment'), 2000, '6,000 carrying amount down to 4,000');
  assert.equal(sim.months.at(-1)!.status, 'held-for-sale');
  assert.equal(sim.months.slice(6).every((m) => m.depreciation === 0), true, 'no depreciation after the classification');
  const back = simulateAsset(asset({ events: [h, ev({ kind: 'reclassify-in-use', date: '2026-09-30' })] }), IFRS, '2027-06');
  assert.equal(back.months.find((m) => m.period === '2026-10')!.depreciation > 0, true, 'depreciation resumes once it is back in use');
});

test('disposal: depreciates up to the sale date, then books proceeds, removes cost and depreciation, and the gain', () => {
  const d = ev({ kind: 'disposal', date: '2026-12-15', proceeds: 10_500 });
  const a = asset({ cost: 12_000, usefulLifeMonths: 60, events: [d] });
  const sim = simulateAsset(a, IFRS, '2028-12');
  assert.equal(sim.months.at(-1)!.period, '2026-12', 'nothing is simulated after the sale');
  assert.equal(sim.months.at(-1)!.depreciation, 96.77, '15 of 31 days of December');
  const p = post(sim.postings, d.id);
  assert.ok(balanced(p));
  assert.equal(amt(p, 'cost'), -12_000);
  assert.equal(amt(p, 'accumulated'), 2296.77, '11 x 200 + 96.77');
  assert.equal(amt(p, 'counter'), 10_500);
  assert.equal(amt(p, 'gainOnDisposal'), -796.77, '10,500 less a carrying amount of 9,703.23');
  assert.equal(positionAt(sim, '2028-12').status, 'disposed');
  assert.equal(positionAt(sim, '2028-12').carrying, 0);
  const loss = simulateAsset(asset({ cost: 12_000, usefulLifeMonths: 60, events: [ev({ kind: 'disposal', date: '2026-12-15', proceeds: 1000, costs: 100 })] }), IFRS, '2026-12');
  const lp = loss.postings.at(-1)!;
  assert.ok(balanced(lp));
  assert.equal(amt(lp, 'counter'), 900, 'proceeds net of selling costs');
  assert.equal(amt(lp, 'lossOnDisposal'), 8803.23);
});

// ── validation ────────────────────────────────────────────────────────────────────────────────────────────────────────

test('validation catches impossible assets and events', () => {
  const v = (a: Partial<FixedAsset>) => validateAsset(asset(a), IFRS);
  assert.deepEqual(v({}), []);
  assert.ok(v({ name: ' ' }).length);
  assert.ok(v({ cost: 0 }).some((m) => /cost must be more than zero/.test(m)));
  assert.ok(v({ residual: 99_999 }).some((m) => /residual value cannot be more/.test(m)));
  assert.ok(v({ usefulLifeMonths: 0 }).some((m) => /useful life/.test(m)));
  assert.ok(v({ method: 'units-of-production' }).some((m) => /total units/.test(m)));
  assert.ok(v({ acquiredOn: '2026-02-30' }).some((m) => /calendar date/.test(m)));
  assert.ok(v({ availableFrom: '2025-12-01' }).some((m) => /before it is acquired/.test(m)));
  assert.ok(v({ events: [ev({ kind: 'improvement', date: '2025-01-01', amount: 5 })] }).some((m) => /before the asset was acquired/.test(m)));
  assert.ok(v({ events: [ev({ kind: 'disposal', date: '2026-06-30', proceeds: 1 }), ev({ kind: 'improvement', date: '2026-08-01', amount: 5 })] }).some((m) => /after the asset was disposed/.test(m)));
  assert.ok(v({ events: [ev({ kind: 'disposal', date: '2026-06-30', proceeds: 1 }), ev({ kind: 'disposal', date: '2026-07-30', proceeds: 1 })] }).some((m) => /only be disposed of once/.test(m)));
  assert.equal(validateAsset(asset({ method: 'none', usefulLifeMonths: 0, category: 'land' }), IFRS).length, 0, 'land needs no life');
});

// ── reading the results ───────────────────────────────────────────────────────────────────────────────────────────────

test('position, cumulative depreciation and the forecast', () => {
  const a = asset();
  const sim = simulateAsset(a, IFRS, '2026-12');
  assert.deepEqual(positionAt(sim, '2026-03'), { gross: 12_000, accumulated: 3000, carrying: 9000, surplus: 0, status: 'in-use' });
  assert.equal(positionAt(sim, '2025-12').gross, 0, 'before the acquisition');
  assert.equal(cumulativeDepreciation(sim, '2026-06'), 6000);
  const f = forecast(a, IFRS, '2026-07', 3);
  assert.deepEqual(f.map((m) => m.period), ['2026-07', '2026-08', '2026-09', '2026-10']);
  assert.equal(f[0].depreciation, 1000);
});

test('roll-forward: opening, additions, depreciation, impairment, revaluation and disposal reconcile to the closing amount', () => {
  const a = asset({ cost: 12_000, usefulLifeMonths: 12 });
  const sim = simulateAsset(a, IFRS, '2027-12');
  const fy26 = rollForward([sim], '2026-01', '2026-12');
  assert.equal(fy26.costOpening, 0);
  assert.equal(fy26.additions, 12_000);
  assert.equal(fy26.depreciation, 12_000);
  assert.equal(fy26.carryingClosing, 0);
  const fy27 = rollForward([sim], '2027-01', '2027-12');
  assert.equal(fy27.costOpening, 12_000);
  assert.equal(fy27.accumOpening, 12_000);
  assert.equal(fy27.depreciation, 0);

  const e = ev({ kind: 'revaluation', date: '2027-12-31', fairValue: 120_000 });
  const i = ev({ kind: 'impairment', date: '2027-03-31', recoverable: 100_000 });
  const big = simulateAsset(revalued([i, e]), IFRS, '2028-12', { transferSurplus: false });
  const rf = rollForward([big], '2027-01', '2027-12');
  // the identity every roll-forward must satisfy: opening + additions - disposals + revaluation - depreciation - impairment + reversal = closing
  const lhs = rf.carryingOpening + rf.additions - (rf.disposals - rf.accumDisposals) + rf.revaluations - rf.depreciation - rf.impairment + rf.impairmentReversal;
  assert.ok(Math.abs(lhs - rf.carryingClosing) < 0.02, `carrying ${lhs} vs ${rf.carryingClosing}`);
  const two = rollForward([sim, simulateAsset(asset({ id: 'b', cost: 6000 }), IFRS, '2027-12')], '2026-01', '2026-12');
  assert.equal(two.additions, 18_000, 'assets add up');
});

test('every posting the engine can make balances and uses a known account', () => {
  const events = [
    ev({ kind: 'revaluation', date: '2027-12-31', fairValue: 120_000 }), ev({ kind: 'impairment', date: '2028-06-30', recoverable: 50_000 }),
    ev({ kind: 'improvement', date: '2028-08-31', amount: 4000 }), ev({ kind: 'held-for-sale', date: '2029-03-31', fairValueLessCosts: 40_000 }),
    ev({ kind: 'disposal', date: '2029-06-15', proceeds: 45_000, costs: 500 }),
  ];
  const sim = simulateAsset(revalued(events), IFRS, '2030-01');
  const known = new Set(['cost', 'accumulated', 'expense', 'surplus', 'retained', 'impairment', 'lossOnDisposal', 'gainOnDisposal', 'reversal', 'counter']);
  assert.ok(sim.postings.length >= 5);
  for (const p of sim.postings) { assert.ok(balanced(p), `${p.key} ${p.memo}`); for (const l of p.lines) assert.ok(known.has(l.account)); }
  assert.deepEqual(sim.issues, []);
  assert.equal(Object.keys(ASSET_ACCOUNTS).length, 9);
});

// ── posting to the ledger ─────────────────────────────────────────────────────────────────────────────────────────────

import { planPostings, normalizeFixedAssets, ledgerBalance, missingCounterAccount, periodLabel, EMPTY_FIXED_ASSETS, type FixedAssetsState, type DepreciationRun, type PostingPlan } from './borga/fixed-asset-journals';

const CTX = { cashAccountId: 'gl-1000', closures: [] as Array<{ startDate: string; endDate: string; label: string }> };
const state = (assets: FixedAsset[], runs: DepreciationRun[] = [], transferSurplus = true): FixedAssetsState => ({ assets, runs, transferSurplus });
const entryBalanced = (e: { lines: Array<{ debit: number; credit: number }> }) => Math.abs(e.lines.reduce((s, l) => s + l.debit - l.credit, 0)) < 0.005;
const allBalanced = (p: PostingPlan) => p.periods.every((pp) => pp.entries.every(entryBalanced));
const runFromPlan = (p: PostingPlan['periods'][number], id: string): DepreciationRun => ({ id, period: p.period, postedAt: '', lines: p.lines, events: [] });

test('depreciation is posted month by month: debit expense, credit accumulated depreciation, plus the acquisition entry', () => {
  const plan = planPostings(state([asset()]), IFRS, '2026-03', CTX);
  assert.deepEqual(plan.periods.map((p) => p.period), ['2026-01', '2026-02', '2026-03']);
  assert.ok(allBalanced(plan));
  const jan = plan.periods[0];
  const dep = jan.entries.find((e) => e.kind === 'depreciation')!;
  assert.equal(dep.dateIso, '2026-01-31');
  assert.equal(dep.reference, 'FA-2026-01');
  assert.deepEqual(dep.lines.map((l) => [l.accountId, l.debit, l.credit]), [[ASSET_ACCOUNTS.expense.id, 1000, 0], [ASSET_ACCOUNTS.accumulated.id, 0, 1000]]);
  const acq = jan.entries.find((e) => e.kind === 'event')!;
  assert.deepEqual(acq.lines.map((l) => [l.accountId, l.debit, l.credit]), [['gl-1400', 12_000, 0], ['gl-1000', 0, 12_000]]);
  assert.equal(plan.periods[1].entries.filter((e) => e.kind === 'event').length, 0, 'the acquisition is only posted once');
  const full = planPostings(state([asset()]), IFRS, '2027-06', CTX);
  assert.equal(full.periods.reduce((s, p) => s + p.depreciation, 0), 12_000, 'the whole depreciable amount, no more');
  assert.equal(full.periods.length, 12, 'nothing is posted for months with no depreciation');
});

test('what has been posted is not posted again, and an asset already in the ledger does not get an acquisition entry', () => {
  const a = asset({ glMode: 'already-in-gl' });
  const first = planPostings(state([a]), IFRS, '2026-02', CTX);
  assert.equal(first.periods.flatMap((p) => p.entries).filter((e) => e.kind === 'event').length, 0);
  const runs = first.periods.map((p, i) => runFromPlan(p, `r${i}`));
  const next = planPostings(state([a], runs), IFRS, '2026-04', CTX);
  assert.deepEqual(next.periods.map((p) => p.period), ['2026-03', '2026-04']);
  assert.equal(planPostings(state([a], runs), IFRS, '2026-02', CTX).periods.length, 0, 'already up to date');
});

test('an asset added after earlier months were posted catches up in the next entry, and the entry says so', () => {
  const old = asset({ id: 'old' });
  const posted = planPostings(state([old]), IFRS, '2026-03', CTX).periods.map((p, i) => runFromPlan(p, `r${i}`));
  const late = asset({ id: 'late', name: 'Late press', cost: 6000, usefulLifeMonths: 12, glMode: 'already-in-gl' });
  const plan = planPostings(state([old, late], posted), IFRS, '2026-04', CTX);
  assert.equal(plan.periods.length, 1);
  const april = plan.periods[0];
  const lateLine = april.lines.find((l) => l.assetId === 'late')!;
  assert.equal(lateLine.amount, 2000, 'four months of 500');
  assert.equal(lateLine.catchUp, true);
  assert.equal(april.lines.find((l) => l.assetId === 'old')!.catchUp, false);
  assert.equal(april.catchUp, 2000);
  assert.match(april.entries[0].description, /includes 2,000\.00 catch-up/);
  assert.ok(allBalanced(plan));
});

test('a month inside a closed period is never posted into: the plan stops and says which period', () => {
  const feb = { startDate: '2026-02-01', endDate: '2026-02-28', label: 'February 2026' };
  const plan = planPostings(state([asset()]), IFRS, '2026-04', { ...CTX, closures: [feb] });
  assert.deepEqual(plan.periods.map((p) => p.period), ['2026-01']);
  assert.deepEqual(plan.blocked, { period: '2026-02', label: 'February 2026' });
  const lateEvent = asset({ events: [ev({ kind: 'improvement', date: '2026-02-10', amount: 500 })] });
  const p2 = planPostings(state([lateEvent]), IFRS, '2026-03', { ...CTX, closures: [feb] });
  assert.equal(p2.blocked?.label, 'February 2026', 'an event dated in a closed period blocks too');
});

test('without a cash or payable account the purchase cannot be built, and the screen is told which assets', () => {
  const plan = planPostings(state([asset()]), IFRS, '2026-02', { closures: [] });
  assert.equal(plan.periods[0].entries.some((e) => e.kind === 'event'), false);
  assert.deepEqual(missingCounterAccount(state([asset()]), IFRS, '2026-02', { closures: [] }), ['Press']);
  assert.deepEqual(missingCounterAccount(state([asset({ counterAccountId: 'gl-2000' })]), IFRS, '2026-02', { closures: [] }), []);
  assert.deepEqual(missingCounterAccount(state([asset({ glMode: 'already-in-gl' })]), IFRS, '2026-02', { closures: [] }), []);
});

test('an asset the framework does not accept is reported and nothing is posted for it', () => {
  const bad = asset({ id: 'bad', name: 'Revalued', model: 'revaluation' });
  const plan = planPostings(state([bad, asset({ id: 'ok' })]), GAAP, '2026-02', CTX);
  assert.equal(plan.problems.length, 1);
  assert.equal(plan.problems[0].name, 'Revalued');
  assert.equal(plan.periods[0].lines.every((l) => l.assetId === 'ok'), true);
});

test('revaluation surplus transfer is its own balanced entry, equity to equity', () => {
  const a = asset({ cost: 120_000, usefulLifeMonths: 120, model: 'revaluation', events: [ev({ kind: 'revaluation', date: '2027-12-31', fairValue: 144_000 })] });
  const plan = planPostings(state([a]), IFRS, '2028-02', CTX);
  assert.ok(allBalanced(plan));
  const jan = plan.periods.find((p) => p.period === '2028-01')!;
  const t = jan.entries.find((e) => e.kind === 'transfer')!;
  assert.deepEqual(t.lines.map((l) => [l.accountId, l.debit, l.credit]), [[ASSET_ACCOUNTS.surplus.id, 500, 0], [ASSET_ACCOUNTS.retained.id, 0, 500]]);
  assert.equal(jan.depreciation, 1500);
  const off = planPostings(state([a], [], false), IFRS, '2028-02', CTX);
  assert.equal(off.periods.flatMap((p) => p.entries).some((e) => e.kind === 'transfer'), false, 'the option can be turned off');
  const revaluationEntry = plan.periods.flatMap((p) => p.entries).find((e) => e.key === a.events[0].id)!;
  assert.equal(revaluationEntry.dateIso, '2027-12-31');
  assert.ok(entryBalanced(revaluationEntry));
});

test('posted events are not posted again', () => {
  const e = ev({ kind: 'improvement', date: '2026-02-10', amount: 500 });
  const a = asset({ acquisitionJournalId: 'je1', events: [{ ...e, journalId: 'je2' } as AssetEvent] });
  const plan = planPostings(state([a]), IFRS, '2026-03', CTX);
  assert.equal(plan.periods.flatMap((p) => p.entries).filter((x) => x.kind === 'event').length, 0);
});

test('the ledger balance of an account counts posted entries only, up to a date', () => {
  const js = [
    { status: 'posted', dateIso: '2026-01-31', lines: [{ accountId: 'gl-1410', debit: 0, credit: 1000 }, { accountId: 'gl-5900', debit: 1000, credit: 0 }] },
    { status: 'posted', dateIso: '2026-02-28', lines: [{ accountId: 'gl-1410', debit: 0, credit: 1000 }] },
    { status: 'draft', dateIso: '2026-02-28', lines: [{ accountId: 'gl-1410', debit: 0, credit: 5000 }] },
    { status: 'voided', dateIso: '2026-02-28', lines: [{ accountId: 'gl-1410', debit: 0, credit: 7000 }] },
  ];
  assert.equal(ledgerBalance(js, 'gl-1410'), -2000);
  assert.equal(ledgerBalance(js, 'gl-1410', '2026-01-31'), -1000);
  assert.equal(ledgerBalance(js, 'gl-9999'), 0);
});

test('saved fixed assets are normalised: damaged ones are dropped, not guessed at', () => {
  assert.deepEqual(normalizeFixedAssets(undefined), EMPTY_FIXED_ASSETS);
  assert.deepEqual(normalizeFixedAssets('junk').assets, []);
  const n = normalizeFixedAssets({ assets: [asset(), { id: 'x' }, null, { ...asset({ id: 'm' }), method: 'magic' }, { ...asset({ id: 'e' }), events: [null, { id: 'ok', kind: 'usage', date: '2026-01-01', units: 1 }, { kind: 'x' }] }],
    runs: [{ id: 'r', period: '2026-01', lines: [] }, { id: 'bad', period: 'Jan', lines: [] }], transferSurplus: false });
  assert.deepEqual(n.assets.map((a) => a.id), ['a1', 'e']);
  assert.equal(n.assets[1].events.length, 1);
  assert.deepEqual(n.runs.map((r) => r.id), ['r']);
  assert.equal(n.transferSurplus, false);
  assert.equal(periodLabel('2026-02'), 'February 2026');
});
