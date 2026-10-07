import test from 'node:test';
import assert from 'node:assert/strict';
import { computeHealth, type HealthInput } from './borga/health';
import { INITIAL_KPI_GROUPS, type Employee, type Invoice, type Lead, type Task } from './borga/data';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const empty: HealthInput = { finance: [], invoices: [], bills: [], leads: [], tasks: [], projects: [], employees: [], ads: [], kpiGroups: [], tickets: null, nowMs: NOW };
const fin = (kind: string, amount: number) => ({ kind, amount });
const inv = (o: Partial<Invoice>): Invoice => ({ id: 'i', number: 'INV-1', client: 'A', amount: 100, status: 'sent', issued: '2026-09-01', due: '2026-12-01', ...o } as Invoice);
const lead = (o: Partial<Lead>): Lead => ({ id: 'l', name: 'n', company: '', email: '', phone: '', value: 1, stage: 'new', source: '', ownerId: '', priority: 'P2', ...o });
const task = (o: Partial<Task>): Task => ({ id: 't', title: 't', detail: '', priority: 'P2', status: 'todo', bucket: 'week', assignee: '', tags: [], due: '', progress: 0, ...o });
const emp = (o: Partial<Employee>): Employee => ({ id: 'e', status: 'active', performance: 80, ...o } as Employee);
const dim = (r: ReturnType<typeof computeHealth>, id: string) => r.dimensions.find((d) => d.id === id)!;

test('a company with nothing recorded is "not enough data", not a score of zero', () => {
  const r = computeHealth(empty);
  assert.equal(r.score, null);
  assert.equal(r.band, 'unknown');
  assert.equal(r.measured, 0);
  assert.equal(r.dimensions.length, 8);
  assert.ok(r.dimensions.every((d) => d.score === null && d.detail.length > 5), 'each missing area says what to add');
});

test('one measured area is still not enough; two give a score', () => {
  assert.equal(computeHealth({ ...empty, finance: [fin('revenue', 1000), fin('expense', 500)] }).score, null);
  const r = computeHealth({ ...empty, finance: [fin('revenue', 1000), fin('expense', 500)], leads: [lead({ stage: 'won' }), lead({ id: 'l2', stage: 'lost' })] });
  assert.notEqual(r.score, null);
  assert.equal(r.measured, 2);
});

test('areas with no data are left out and the rest carry the weight, so doing no ads costs nothing', () => {
  const base = { ...empty, finance: [fin('revenue', 1000), fin('expense', 400)], leads: [lead({ stage: 'won' }), lead({ id: 'x', stage: 'won' }), lead({ id: 'y', stage: 'lost' })] };
  const noAds = computeHealth(base);
  assert.equal(dim(noAds, 'marketing').score, null);
  // profitability: margin 60% -> capped at 100. sales: 2/3 won -> capped at 100. Both full, so the score is 100 with weights 25 and 15.
  assert.equal(noAds.score, 100);
  const badAds = computeHealth({ ...base, ads: [{ spent: 10_000, conversions: 1 }] });
  assert.ok(badAds.score! < 100, 'but ads that run badly do count');
});

test('profitability follows the margin: -30% is 0, break-even is 50, +30% is 100', () => {
  const p = (rev: number, exp: number) => dim(computeHealth({ ...empty, finance: [fin('revenue', rev), fin('expense', exp)] }), 'profitability').score;
  assert.equal(p(1000, 1300), 0);
  assert.equal(p(1000, 1000), 50);
  assert.equal(p(1000, 700), 100);
  assert.equal(p(1000, 2000), 0, 'clamped');
  assert.equal(dim(computeHealth({ ...empty, finance: [fin('expense', 500)] }), 'profitability').score, 0, 'spending with no revenue');
  assert.equal(dim(computeHealth({ ...empty, finance: [{ kind: 'revenue', amount: 9000, voidedAt: '2026-10-01' }, fin('expense', 0)] }), 'profitability').score, null, 'voided entries do not count');
});

test('collections measure what is overdue, by value, and bills too', () => {
  const c = (invoices: Invoice[], bills: HealthInput['bills'] = []) => dim(computeHealth({ ...empty, invoices, bills }), 'collections').score;
  assert.equal(c([inv({ amount: 100 })]), 100, 'nothing overdue');
  assert.equal(c([inv({ amount: 100, due: '2026-09-01' }), inv({ id: 'b', amount: 300, due: '2026-12-01' })]), 75, '100 of 400 is overdue');
  assert.equal(c([inv({ status: 'paid' })]), 100, 'everything paid');
  assert.equal(c([inv({ status: 'draft' }), inv({ id: 'v', voidedAt: '2026-10-01' })]), null, 'drafts and voided are not receivables');
  assert.equal(c([inv({ amount: 100, due: '2026-09-01' })], [{ id: 'b1', status: 'unpaid', due: '2026-12-01', amount: 5 } as HealthInput['bills'][number]]), 50, 'average of receivables (0) and bills (100)');
});

test('sales count decided deals only: an open pipeline is not a loss', () => {
  const s = (leads: Lead[]) => dim(computeHealth({ ...empty, leads }), 'sales').score;
  assert.equal(s([lead({}), lead({ id: 'b' }), lead({ id: 'c' })]), null, 'nothing decided yet');
  assert.equal(s([lead({ stage: 'won' }), ...[1, 2, 3].map((i) => lead({ id: `o${i}` }))]), 100, 'one win and three open deals is a 100% win rate, not 25%');
  assert.equal(s([lead({ stage: 'won' }), lead({ id: 'l', stage: 'lost' })]), 100, '50% win rate is above the 40% that scores full marks');
  assert.equal(s([lead({ stage: 'won' }), ...[1, 2, 3, 4].map((i) => lead({ id: `l${i}`, stage: 'lost' }))]), 50, '20% win rate scores half');
});

test('delivery weighs finished tasks and overdue ones, ignoring free-text due dates', () => {
  const d = (tasks: Task[], projects: HealthInput['projects'] = []) => dim(computeHealth({ ...empty, tasks, projects }), 'delivery').score;
  assert.equal(d([]), null);
  assert.equal(d([task({ status: 'done' }), task({ id: 'b', status: 'done' })]), 100);
  assert.equal(d([task({ due: 'This week' })]), 40, 'open, not done, and "This week" is not a date so it is not overdue');
  assert.equal(d([task({ due: '2026-09-01' })]), 0, 'open and past a real date');
  assert.equal(d([task({ status: 'done' }), task({ id: 'b', due: '2026-09-01' })]), 50 * 0.6 + 0, 'half done, the other overdue');
  assert.equal(d([task({ status: 'done' })], [{ id: 'p', budgetAmount: 100, actualSpend: 500 }]), 90, 'a project over budget costs 10');
});

test('support, people, marketing and KPIs are measured only when there is something to measure', () => {
  const r = computeHealth({
    ...empty,
    tickets: { total: 10, unresolved: 4, breached: 1 },
    employees: [emp({ performance: 90 }), emp({ id: 'e2', performance: 70 }), emp({ id: 'gone', status: 'offboarded', performance: 0 })],
  });
  assert.equal(dim(r, 'support').score, 75);
  assert.equal(dim(r, 'people').score, 80);
  assert.equal(dim(r, 'marketing').score, null);
  assert.equal(dim(computeHealth({ ...empty, tickets: { total: 0, unresolved: 0, breached: 0 } }), 'support').score, null, 'no tickets yet');
  assert.equal(dim(computeHealth({ ...empty, tickets: { total: 5, unresolved: 0, breached: 0 } }), 'support').score, 100, 'all resolved');
  const kp = INITIAL_KPI_GROUPS.map((g) => ({ ...g, kpis: g.kpis.map((k) => ({ ...k })) }));
  assert.equal(dim(computeHealth({ ...empty, kpiGroups: kp }), 'kpis').score, null, 'starter KPIs have no measured values');
  const sales = kp.find((g) => g.id === 'sales')!;
  sales.kpis[1] = { ...sales.kpis[1], value: sales.kpis[1].target, valueSet: true };
  sales.kpis[0] = { ...sales.kpis[0], value: sales.kpis[0].target / 2, valueSet: true };
  assert.equal(dim(computeHealth({ ...empty, kpiGroups: kp }), 'kpis').score, 75, 'a KPI at target and one at half target');
});

test('bands, and the weakest area is named when it drags the score down', () => {
  const strong = computeHealth({ ...empty, finance: [fin('revenue', 1000), fin('expense', 600)], leads: [lead({ stage: 'won' })], invoices: [inv({})] });
  assert.equal(strong.label, 'Strong');
  assert.equal(strong.weakest, null);
  const weak = computeHealth({ ...empty, finance: [fin('revenue', 1000), fin('expense', 1300)], invoices: [inv({ due: '2026-09-01' })] });
  assert.equal(weak.band, 'risk');
  assert.equal(weak.score, 0);
  assert.ok(weak.weakest && ['profitability', 'collections'].includes(weak.weakest.id));
  const mid = computeHealth({ ...empty, finance: [fin('revenue', 1000), fin('expense', 1000)], invoices: [inv({})] });
  assert.equal(mid.score, Math.round((25 * 50 + 20 * 100) / 45));
  assert.equal(mid.band, 'healthy');
});
