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
