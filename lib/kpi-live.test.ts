import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_KPI_GROUPS, type Lead, type Customer, type Task, type Goal, type Employee } from './borga/data';
import { applyLiveKpis, deriveLiveKpis } from './borga/kpi-live';
import { DEFAULT_BUSINESS_HOURS, DEFAULT_SLA_POLICIES, type TicketSummary } from './borga/tickets';

const NOW = Date.parse('2026-10-06T12:00:00Z');
const lead = (o: Partial<Lead>): Lead => ({ id: Math.random().toString(), name: 'n', company: 'c', email: '', phone: '', value: 1000, stage: 'new', source: '', ownerId: '', priority: 'medium', ...o }) as Lead;

test('a company with no records has no live KPIs (nothing is scored as zero)', () => {
  const ov = deriveLiveKpis({ nowMs: NOW });
  assert.equal(ov.sales?.['Win Rate'], undefined);
  assert.equal(ov.finance?.Revenue, undefined);
  assert.equal(ov.people?.Headcount, undefined);
  assert.equal(ov.support, undefined);
});

test('deals, customers, tasks, goals and people produce real ratios', () => {
  const leads = [lead({ stage: 'won', value: 3000, createdAt: '2026-10-01T00:00:00Z' }), lead({ stage: 'lost' }), lead({ stage: 'qualified', value: 6000, createdAt: '2026-08-01T00:00:00Z' }), lead({ stage: 'new', value: 4000, createdAt: '2026-10-05T00:00:00Z' })];
  const customers = [{ status: 'active' }, { status: 'active' }, { status: 'active' }, { status: 'churned' }, { status: 'prospect' }] as Customer[];
  const tasks = [{ status: 'done' }, { status: 'todo' }, { status: 'in-progress' }, { status: 'done' }] as Task[];
  const goals = [{ progress: 40 }, { progress: 80 }] as Goal[];
  const employees = [{ status: 'active' }, { status: 'active' }, { status: 'active' }, { status: 'offboarded' }] as Employee[];
  const ov = deriveLiveKpis({ nowMs: NOW, leads, customers, tasks, goals, employees, revenueTarget: 50000 });
  assert.equal(ov.sales['Win Rate'].value, 50);
  assert.equal(ov.sales['Pipeline Coverage'].value, 20); // 10,000 open / 50,000
  assert.equal(ov.marketing['Conv. Rate'].value, 25);
  assert.equal(ov.marketing.MQLs.value, 2); // two created in the last 30 days
  assert.equal(ov.product.Churn.value, 25);
  assert.equal(ov.product.Retention.value, 75);
  assert.equal(ov.engineering.Velocity.value, 50);
  assert.equal(ov.operations.Backlog.value, 2);
  assert.equal(ov.strategy['OKR Attain'].value, 60);
  assert.equal(ov.people.Attrition.value, 25);
  assert.equal(ov.people.Headcount.value, 3);
});

test('support KPIs come from the ticket desk', () => {
  const t = (o: Partial<TicketSummary>): TicketSummary => ({ id: 'x', status: 'resolved', priority: 'medium', slaPolicyId: 'sla-premium', createdAt: '2026-10-05T00:00:00Z', firstResponseAt: '2026-10-05T00:30:00Z', resolvedAt: '2026-10-05T06:00:00Z', pauses: [], ...o }) as TicketSummary;
  const settings = { slaPolicies: DEFAULT_SLA_POLICIES, defaultSlaPolicyId: 'sla-premium', businessHours: DEFAULT_BUSINESS_HOURS } as never;
  const ov = deriveLiveKpis({ nowMs: NOW, tickets: [t({}), t({ id: 'y', status: 'open', firstResponseAt: null, resolvedAt: null })], ticketSettings: settings });
  assert.equal(ov.support['Tickets Resolved'].value, 1);
  assert.equal(ov.support['FRT (min)'].value, 30);
  assert.equal(ov.support['SLA Met'].value, 100);
});

test('live values are written into the saved set once, and removed when the data is gone', () => {
  const ov = deriveLiveKpis({ nowMs: NOW, leads: [lead({ stage: 'won' }), lead({ stage: 'lost' })] });
  const first = applyLiveKpis(INITIAL_KPI_GROUPS, ov);
  assert.equal(first.changed, true);
  const win = first.groups.find((g) => g.id === 'sales')!.kpis.find((k) => k.label === 'Win Rate')!;
  assert.deepEqual([win.value, win.live, win.valueSet], [50, true, true]);
  assert.equal(win.target, 30, 'the target is untouched');
  assert.equal(applyLiveKpis(first.groups, ov).changed, false, 'saving again changes nothing');
  const gone = applyLiveKpis(first.groups, {});
  const back = gone.groups.find((g) => g.id === 'sales')!.kpis.find((k) => k.label === 'Win Rate')!;
  assert.deepEqual([back.live, back.valueSet, back.value], [false, false, 0]);
});
