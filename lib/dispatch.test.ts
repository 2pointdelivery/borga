import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_BATCH, MAX_RUNS_PER_HOUR, emptyLedger, invoiceGoal, invoicePriority, invoicesBatchGoal, isLowValueTicket, leadGoal, leadPriority,
  leadsBatchGoal, overdueInvoices, specialistFor, staleLeads, taskPriority, ticketPriority, unassignedTasks, withinDailyCap,
} from './borga/automation-core';
import { agentStatusNow, busyFromJobs } from './borga/agent-status';
import { effectivePriority, jobRank, nextQueuedJob } from './borga/run-queue-core';
import { AGENTS, type Invoice, type Lead, type RunJob, type Task } from './borga/data';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const lead = (o: Partial<Lead>): Lead => ({ id: 'l1', name: 'Ama', company: 'Acme', email: '', phone: '', value: 5000, stage: 'new', source: 'web', ownerId: '', priority: 'P2', ...o });
const inv = (o: Partial<Invoice>): Invoice => ({ id: 'i1', number: 'INV-1', client: 'Acme', amount: 100, status: 'sent', issued: '2026-09-01', due: '2026-09-30', ...o } as Invoice);
const task = (o: Partial<Task>): Task => ({ id: 't1', title: 'Draft a proposal', detail: '', priority: 'P1', status: 'todo', bucket: 'week', assignee: 'Atlas', tags: [], due: '', progress: 0, ...o });
const job = (o: Partial<RunJob>): RunJob => ({ id: 'j', agentId: 'a-sales', agentName: 'Atlas', goal: 'g', triggeredBy: 'automation', status: 'queued', enqueuedAt: '2026-10-10T12:00:00.000Z', ...o });

test('priorities follow what is at stake, P0 first', () => {
  assert.deepEqual(['critical', 'high', 'medium', 'low'].map(ticketPriority), [0, 1, 2, 3]);
  assert.equal(leadPriority(lead({ priority: 'P2', value: 500 })), 2);
  assert.equal(leadPriority(lead({ priority: 'P2', value: 20_000 })), 1, 'a big deal moves up one');
  assert.equal(leadPriority(lead({ priority: 'P0', value: 20_000 })), 0, 'and never past P0');
  const late = (daysOverdue: number, amount: number) => ({ invoice: inv({ amount }), daysOverdue, key: 'k' });
  assert.deepEqual([late(50, 100), late(20, 100), late(3, 100), late(3, 12_000)].map(invoicePriority), [1, 2, 3, 1]);
  assert.equal(taskPriority(task({ priority: 'P0' })), 0);
});

test('automatic replies and no-reply senders are not worth a model call', () => {
  assert.equal(isLowValueTicket({ subject: 'Out of office until Monday', requesterEmail: 'sam@acme.com' }), true);
  assert.equal(isLowValueTicket({ subject: 'Re: Automatic reply: your request', requesterEmail: 'sam@acme.com' }), true);
  assert.equal(isLowValueTicket({ subject: 'Undeliverable: invoice 42', requesterEmail: 'mailer-daemon@mail.com' }), true);
  assert.equal(isLowValueTicket({ subject: 'Hello', requesterEmail: 'no-reply@shop.com' }), true);
  assert.equal(isLowValueTicket({ subject: 'Hello', requesterEmail: 'donotreply@shop.com' }), true);
  assert.equal(isLowValueTicket({ subject: 'Cannot log in', requesterEmail: 'sam@acme.com' }), false);
  assert.equal(isLowValueTicket({ subject: 'Replying to your offer', requesterEmail: 'nora@acme.com' }), false, 'a person called Nora is not a no-reply');
});

test('Borga hands an open task to the specialist whose skills match, and leaves it to a person when nobody fits', () => {
  const hit = specialistFor({ title: 'Build a sales pipeline forecast for Q4', detail: 'Proposals and deal stages', tags: [] }, AGENTS);
  assert.equal(hit?.agent.id, 'a-sales');
  assert.ok(hit!.score >= 2 && hit!.matched.length === hit!.score);
  assert.equal(specialistFor({ title: 'Buy flowers for the office', detail: '', tags: [] }, AGENTS), null, 'nothing fits: a person does it');
  assert.equal(specialistFor({ title: 'Pipeline', detail: '', tags: [] }, AGENTS), null, 'one shared word is not enough');
  assert.notEqual(specialistFor({ title: 'Reconcile the ledger and prepare the tax return', detail: 'bookkeeping close', tags: [] }, AGENTS)?.agent.id, 'a-borga', 'Borga never assigns to itself');
  const off = AGENTS.map((a) => (a.id === 'a-sales' ? { ...a, status: 'offline' as const } : a));
  assert.notEqual(specialistFor({ title: 'Build a sales pipeline forecast for Q4', detail: 'Proposals and deal stages', tags: [] }, off)?.agent.id, 'a-sales', 'an offline agent is skipped');
});

test('only new, unowned, important tasks are candidates for Borga to assign', () => {
  const base = { title: 'Build a sales pipeline forecast', detail: 'proposals and deal stages', assignee: '' };
  assert.equal(unassignedTasks([task({ ...base })], AGENTS).length, 1);
  assert.equal(unassignedTasks([task({ ...base, assignee: 'Borga' })], AGENTS).length, 1, 'Borga-owned counts as unowned');
  assert.equal(unassignedTasks([task({ ...base, assignee: 'Kofi Mensah' })], AGENTS).length, 0, 'a person owns it');
  assert.equal(unassignedTasks([task({ ...base, priority: 'P3' })], AGENTS).length, 0, 'low priority waits');
  assert.equal(unassignedTasks([task({ ...base, source: 'agent' })], AGENTS).length, 0, 'agents do not feed themselves');
  assert.equal(unassignedTasks([task({ ...base, status: 'in-progress' })], AGENTS).length, 0);
});

test('several items for one agent make one run, and the goal covers each', () => {
  const stale = [1, 2, 3].map((i) => staleLeads([lead({ id: `l${i}`, name: `Lead ${i}`, createdAt: daysAgo(6) })], NOW, {})[0]);
  const g = leadsBatchGoal(stale, 'Atlas');
  assert.ok(g.includes('3 leads') && g.includes('Lead 1') && g.includes('Lead 3') && g.includes('EACH'));
  assert.ok(g.includes('Do not send'));
  assert.equal(leadsBatchGoal([stale[0]], 'Atlas'), leadGoal(stale[0], 'Atlas'), 'one lead keeps the single-item goal');
  const invs = overdueInvoices([inv({ id: 'a', number: 'INV-A' }), inv({ id: 'b', number: 'INV-B' })], NOW);
  const ig = invoicesBatchGoal(invs);
  assert.ok(ig.includes('INV-A') && ig.includes('INV-B') && ig.includes('Do not send'));
  assert.equal(invoicesBatchGoal([invs[0]]), invoiceGoal(invs[0]));
  assert.ok(MAX_BATCH >= 2 && MAX_BATCH <= 5);
});

test('an hour has its own budget, so a burst cannot spend the whole day', () => {
  let led = emptyLedger();
  for (let i = 0; i < MAX_RUNS_PER_HOUR; i++) {
    const c = withinDailyCap(led, '2026-10-10', '2026-10-10T12');
    assert.equal(c.ok, true);
    led = { ...c.ledger, runsToday: c.ledger.runsToday + 1, runsThisHour: c.ledger.runsThisHour + 1 };
  }
  assert.equal(withinDailyCap(led, '2026-10-10', '2026-10-10T12').ok, false, 'this hour is spent');
  assert.equal(withinDailyCap(led, '2026-10-10', '2026-10-10T13').ok, true, 'the next hour starts fresh');
  assert.equal(withinDailyCap(led, '2026-10-10').ok, true, 'without an hour only the day counts');
});

test('the queue hands out P0 before P3, people before automation, then first come first served', () => {
  const order = (jobs: RunJob[]) => jobs.slice().sort((a, b) => jobRank(a) - jobRank(b)).map((j) => j.id);
  assert.deepEqual(order([job({ id: 'p3', priority: 3 }), job({ id: 'p0', priority: 0 }), job({ id: 'p2', priority: 2 }), job({ id: 'p1', priority: 1 })]), ['p0', 'p1', 'p2', 'p3']);
  assert.deepEqual(order([job({ id: 'auto-p2', priority: 2 }), job({ id: 'user', triggeredBy: 'user' }), job({ id: 'sched', triggeredBy: 'scheduler' })]), ['user', 'sched', 'auto-p2']);
  assert.deepEqual(order([job({ id: 'later', enqueuedAt: '2026-10-10T12:05:00.000Z', priority: 1 }), job({ id: 'first', enqueuedAt: '2026-10-10T12:01:00.000Z', priority: 1 })]), ['first', 'later'], 'first come first served within a priority');
  assert.deepEqual(order([job({ id: 'urgent-p3', urgent: true, priority: 3 }), job({ id: 'p0', priority: 0 })]), ['urgent-p3', 'p0'], 'urgent beats priority');
  assert.equal(effectivePriority({ triggeredBy: 'user' }), 0);
  assert.equal(effectivePriority({ triggeredBy: 'scheduler' }), 2);
  assert.equal(effectivePriority({ triggeredBy: 'user', priority: 3 }), 3, 'an explicit priority wins');
});

test('automatic work runs one at a time, and never holds up a person', () => {
  const running = job({ id: 'busy', status: 'running' });
  assert.equal(nextQueuedJob([running, job({ id: 'next-auto' })]), null, 'the automation lane is full');
  assert.equal(nextQueuedJob([running, job({ id: 'next-auto' }), job({ id: 'person', triggeredBy: 'user' })])?.id, 'person');
  assert.equal(nextQueuedJob([job({ id: 'a', priority: 2 }), job({ id: 'b', priority: 0 })])?.id, 'b', 'with the lane free, the more important one goes first');
  assert.equal(nextQueuedJob([job({ id: 'busy-user', triggeredBy: 'user', status: 'running' }), job({ id: 'auto' })])?.id, 'auto', 'a running person-started job does not block the lane');
});

test('an agent is active only while it has work, idle otherwise', () => {
  const busy = busyFromJobs([
    { agentId: 'a-sales', status: 'queued' }, { agentId: 'a-sales', status: 'running' }, { agentId: 'a-finance', status: 'queued' },
    { agentId: 'a-support', status: 'complete' }, { agentId: 'a-design', status: 'error' },
  ]);
  assert.deepEqual(busy, { 'a-sales': 'running', 'a-finance': 'queued' });
  const get = (id: string) => AGENTS.find((a) => a.id === id)!;
  assert.equal(agentStatusNow(get('a-sales'), busy), 'active');
  assert.equal(agentStatusNow(get('a-finance'), busy), 'active', 'waiting work counts: it is about to start');
  assert.equal(agentStatusNow(get('a-support'), busy), 'idle', 'finished work is not work');
  assert.equal(agentStatusNow({ id: 'x', status: 'offline' }, { x: 'running' }), 'offline', 'offline stays offline');
});
