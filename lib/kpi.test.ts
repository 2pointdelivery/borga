import test from 'node:test';
import assert from 'node:assert/strict';
import { DEPARTMENTS, INITIAL_KPI_GROUPS, kpiAttainment, kpiMeasured, type KpiEntry } from './borga/data';

const k = (p: Partial<KpiEntry>): KpiEntry => ({ label: 'x', value: 0, target: 0, unit: '', delta: 0, ...p });

test('new workspaces are seeded with best-practice KPI targets, not fabricated values', () => {
  assert.equal(INITIAL_KPI_GROUPS.length, DEPARTMENTS.length);
  assert.ok(INITIAL_KPI_GROUPS.length >= 10, 'a broad set of departments is seeded');
  const all = INITIAL_KPI_GROUPS.flatMap((g) => g.kpis);
  assert.ok(all.length >= 40, 'a broad set of KPIs is seeded');
  for (const entry of all) {
    assert.equal(entry.value, 0, `${entry.label} must not ship a fabricated value`);
    assert.equal(entry.delta, 0, `${entry.label} must not ship a fabricated trend`);
    assert.equal(entry.valueSet, false, `${entry.label} must start unmeasured`);
    assert.ok(entry.direction === 'higher' || entry.direction === 'lower', `${entry.label} needs a direction`);
    assert.ok(entry.benchmark && entry.benchmark.length > 0, `${entry.label} needs a benchmark note`);
  }
  // Common best-practice benchmarks are seeded as starting targets.
  const winRate = INITIAL_KPI_GROUPS.find((g) => g.id === 'sales')!.kpis.find((x) => x.label === 'Win Rate')!;
  assert.equal(winRate.target, 30);
  const margin = INITIAL_KPI_GROUPS.find((g) => g.id === 'finance')!.kpis.find((x) => x.label === 'Gross Margin')!;
  assert.equal(margin.target, 45);
  // Direction is set correctly for lower-is-better metrics.
  for (const label of ['Burn Rate', 'Churn', 'CAC']) {
    const entry = all.find((x) => x.label === label);
    if (entry) assert.equal(entry.direction, 'lower', label);
  }
});

test('a KPI counts only when it has actually been measured', () => {
  assert.equal(kpiMeasured(k({ live: true, valueSet: false })), true);
  assert.equal(kpiMeasured(k({ valueSet: true, value: 0 })), true, 'an intentional zero still counts');
  assert.equal(kpiMeasured(k({ valueSet: false, value: 0 })), false);
  assert.equal(kpiMeasured(k({ value: 0 })), false, 'unset legacy entry');
  assert.equal(kpiMeasured(k({ value: 5 })), true, 'legacy non-zero value still counts');
});

test('attainment respects higher-is-better targets and caps at 100', () => {
  assert.equal(kpiAttainment(k({ value: 45, target: 100 })), 45);
  assert.equal(kpiAttainment(k({ value: 150, target: 100 })), 100);
  assert.equal(kpiAttainment(k({ value: 40, target: 0 })), null, 'no target, nothing to score against');
});

test('attainment flips for lower-is-better targets', () => {
  assert.equal(kpiAttainment(k({ value: 12, target: 8, direction: 'lower' })), 67);
  assert.equal(kpiAttainment(k({ value: 4, target: 8, direction: 'lower' })), 100);
  assert.equal(kpiAttainment(k({ value: 0, target: 8, direction: 'lower' })), 100);
  assert.equal(kpiAttainment(k({ value: 2, target: 0, direction: 'lower' })), null, 'no target, nothing to score against');
  assert.equal(kpiAttainment(k({ value: 0, target: 0, direction: 'lower' })), null);
});

import { DEPARTMENTS as BASELINE, INITIAL_KPI_GROUPS as BASE_GROUPS, completeKpiGroups, deriveKpiOverrides, type KpiGroup, type Lead as KLead } from './borga/data';

test('every best-practice KPI has a target to score against, except the ones where zero is the goal', () => {
  const zeroOk = new Set(['Critical Vulns']);
  for (const d of BASELINE) for (const k of d.kpis) {
    if (zeroOk.has(k.label)) { assert.equal(k.direction, 'lower', `${k.label} is lower-is-better`); assert.equal(k.zeroTarget, true); continue; }
    assert.ok(k.target > 0, `${d.id} / ${k.label} has a target`);
    assert.ok(k.benchmark && k.benchmark.length > 10, `${d.id} / ${k.label} has a benchmark note`);
  }
});

test('a new company gets the full set; an existing one is completed without losing its own work', () => {
  const fresh = completeKpiGroups(undefined);
  assert.equal(fresh.changed, true);
  assert.equal(fresh.groups.length, BASELINE.length);
  assert.equal(fresh.groups.flatMap((g) => g.kpis).length, BASELINE.flatMap((d) => d.kpis).length);

  const mine: KpiGroup[] = [
    { id: 'sales', name: 'Sales', kpis: [
      { label: 'Win Rate', value: 41, target: 45, unit: '%', delta: 0, valueSet: true, direction: 'higher' }, // measured, own target
      { label: 'Avg Deal Size', value: 0, target: 0, unit: '$', delta: 0, valueSet: false }, // never set up
      { label: 'My own KPI', value: 7, target: 10, unit: '', delta: 0, valueSet: true },
    ] },
    { id: 'custom', name: 'Custom group', kpis: [] },
  ];
  const done = completeKpiGroups(mine);
  assert.equal(done.changed, true);
  const sales = done.groups.find((g) => g.id === 'sales')!;
  const win = sales.kpis.find((k) => k.label === 'Win Rate')!;
  assert.deepEqual([win.value, win.target], [41, 45], 'a measured value and its own target are kept');
  assert.equal(sales.kpis.find((k) => k.label === 'Avg Deal Size')!.target, BASELINE.find((d) => d.id === 'sales')!.kpis.find((k) => k.label === 'Avg Deal Size')!.target, 'an unset target takes the baseline');
  assert.ok(sales.kpis.some((k) => k.label === 'My own KPI'), 'added KPIs stay');
  assert.ok(sales.kpis.some((k) => k.label === 'Pipeline Coverage'), 'missing KPIs are added');
  assert.ok(done.groups.some((g) => g.id === 'custom'), 'added groups stay');
  assert.equal(done.groups.length, BASELINE.length + 1);
  // a company with a measured KPI whose target it set to 0 on purpose keeps that
  const deliberate = completeKpiGroups([{ id: 'sales', name: 'Sales', kpis: [{ label: 'Deals Closed', value: 3, target: 0, unit: '', delta: 0, valueSet: true }] }]);
  assert.equal(deliberate.groups[0].kpis.find((k) => k.label === 'Deals Closed')!.target, 0);
  // already complete: nothing to save
  assert.equal(completeKpiGroups(done.groups).changed, false);
  assert.equal(completeKpiGroups(BASE_GROUPS).changed, false);
});

test('a lower-is-better KPI with a target of zero is met only by zero', async () => {
  const { kpiAttainment } = await import('./borga/data');
  const vuln = { label: 'Critical Vulns', target: 0, unit: '', delta: 0, direction: 'lower' as const, zeroTarget: true };
  assert.equal(kpiAttainment({ ...vuln, value: 0, valueSet: true }), 100);
  assert.equal(kpiAttainment({ ...vuln, value: 2, valueSet: true }), 0);
  assert.equal(kpiAttainment({ ...vuln, value: 0, valueSet: false }), null, 'unmeasured is not scored');
  assert.equal(kpiAttainment({ ...vuln, zeroTarget: false, value: 2, valueSet: true }), null, 'without the flag a target of 0 still means not set up');
});

test('win rate and average deal size come from the leads', () => {
  const lead = (o: Partial<KLead>): KLead => ({ id: 'x', name: 'n', company: '', email: '', phone: '', value: 0, stage: 'new', source: '', ownerId: '', priority: 'P2', ...o });
  const o = deriveKpiOverrides({ leads: [lead({ id: '1', stage: 'won', value: 3000 }), lead({ id: '2', stage: 'won', value: 5000 }), lead({ id: '3', stage: 'lost' }), lead({ id: '4', stage: 'lost' })] });
  assert.equal(o.sales['Win Rate'].value, 50);
  assert.equal(o.sales['Avg Deal Size'].value, 4000);
  const none = deriveKpiOverrides({ leads: [lead({})] });
  assert.equal(none.sales['Win Rate'], undefined, 'nothing closed yet: no invented rate');
  assert.equal(none.sales['Avg Deal Size'], undefined);
});
