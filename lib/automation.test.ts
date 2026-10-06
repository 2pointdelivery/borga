import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEAD_STALE_DAYS, MAX_RUNS_PER_DAY, agentTasks, emptyLedger, invoiceGoal, leadGoal, normalizeLedger, overdueInvoices, pruneLedger,
  resolveAutomations, routeAgent, staleLeads, taskGoal, ticketGoal, withinDailyCap,
} from './borga/automation-core';
import { AGENTS, type Invoice, type Lead, type Task } from './borga/data';
import { PERSONA_INSTRUCTIONS, effectiveInstructions, withPersonaInstructions } from './borga/agent-personas';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const lead = (o: Partial<Lead>): Lead => ({ id: 'l1', name: 'Ama', company: 'Acme', email: '', phone: '', value: 5000, stage: 'new', source: 'web', ownerId: '', priority: 'P2', ...o });
const inv = (o: Partial<Invoice>): Invoice => ({ id: 'i1', number: 'INV-1', client: 'Acme', amount: 100, status: 'sent', issued: '2026-09-01', due: '2026-09-30', ...o } as Invoice);
const task = (o: Partial<Task>): Task => ({ id: 't1', title: 'Draft a proposal', detail: '', priority: 'P1', status: 'todo', bucket: 'week', assignee: 'Atlas', tags: [], due: '', progress: 0, ...o });

test('every seeded agent has operating instructions, and a company edit wins over the default', () => {
  assert.ok(AGENTS.length >= 50);
  for (const a of AGENTS) assert.ok((a.instructions ?? '').trim().length > 40, `${a.name} has instructions`);
  const sales = AGENTS.find((a) => a.id === 'a-sales')!;
  assert.equal(effectiveInstructions({ persona: sales.persona, instructions: 'Only sell to schools.' }), 'Only sell to schools.');
  assert.equal(effectiveInstructions({ persona: sales.persona, instructions: '  ' }), PERSONA_INSTRUCTIONS[sales.persona!]);
  assert.equal(withPersonaInstructions({ persona: sales.persona, instructions: '' }).instructions, PERSONA_INSTRUCTIONS[sales.persona!]);
  assert.equal(withPersonaInstructions({ persona: 'unknown.md', instructions: '' }).instructions, '', 'nothing invented for an unknown persona');
});

test('topics route to the named lead, then the department, then the orchestrator, never an offline agent', () => {
  assert.equal(routeAgent(AGENTS, 'support')?.id, 'a-support');
  assert.equal(routeAgent(AGENTS, 'sales')?.id, 'a-sales');
  assert.equal(routeAgent(AGENTS, 'finance')?.id, 'a-finance');
  const noSupportLead = AGENTS.filter((a) => a.id !== 'a-support').map((a) => (a.id === 'a-security' ? { ...a, department: 'Support' } : a));
  assert.equal(routeAgent(noSupportLead, 'support')?.id, 'a-security', 'falls back to the department');
  const offline = AGENTS.map((a) => (a.id === 'a-support' ? { ...a, status: 'offline' as const } : a)).filter((a) => a.department !== 'Support' || a.id === 'a-support');
  assert.equal(routeAgent(offline, 'support')?.id, 'a-borga', 'falls back to the orchestrator');
  assert.equal(routeAgent([], 'sales'), null);
});

test('a lead is chased only after its stage allows, and again only after another period', () => {
  const stale = staleLeads([lead({ stage: 'new', createdAt: daysAgo(LEAD_STALE_DAYS.new + 1) })], NOW, {});
  assert.equal(stale.length, 1);
  assert.equal(stale[0].key, 'lead:l1:new:1');
  assert.equal(staleLeads([lead({ createdAt: daysAgo(1) })], NOW, {}).length, 0, 'fresh');
  assert.equal(staleLeads([lead({ stage: 'won', createdAt: daysAgo(30) })], NOW, {}).length, 0, 'closed leads are left alone');
  assert.equal(staleLeads([lead({ stage: 'lost', createdAt: daysAgo(30) })], NOW, {}).length, 0);
  // contact resets the clock
  assert.equal(staleLeads([lead({ createdAt: daysAgo(30), lastContactAt: daysAgo(0.5) })], NOW, {}).length, 0);
  // a later period gets a new key, so it is chased again
  const later = staleLeads([lead({ createdAt: daysAgo(LEAD_STALE_DAYS.new * 2 + 1) })], NOW, {});
  assert.equal(later[0].key, 'lead:l1:new:2');
});

test('a lead with no dates starts its clock when the engine first sees it, so a backlog is not chased at once', () => {
  assert.equal(staleLeads([lead({})], NOW, {}).length, 0, 'unknown age: not chased');
  assert.equal(staleLeads([lead({})], NOW, { l1: daysAgo(0) }).length, 0, 'seen just now');
  assert.equal(staleLeads([lead({})], NOW, { l1: daysAgo(3) }).length, 1, 'seen three days ago');
});

test('overdue invoices are chased weekly, never when paid, draft or voided', () => {
  assert.equal(overdueInvoices([inv({})], NOW).length, 1);
  assert.equal(overdueInvoices([inv({})], NOW)[0].daysOverdue, 10);
  assert.equal(overdueInvoices([inv({ status: 'paid' }), inv({ id: 'i2', status: 'draft' }), inv({ id: 'i3', voidedAt: '2026-10-01' })], NOW).length, 0);
  assert.equal(overdueInvoices([inv({ due: '2026-10-11' })], NOW).length, 0, 'not due yet');
  assert.notEqual(overdueInvoices([inv({})], NOW)[0].key, overdueInvoices([inv({ due: '2026-09-20' })], NOW)[0].key, 'a later week is a new key');
});

test('only unstarted tasks assigned to a live agent are handed over, by name or id', () => {
  assert.equal(agentTasks([task({})], AGENTS)[0].agent.id, 'a-sales');
  assert.equal(agentTasks([task({ assignee: 'a-finance' })], AGENTS)[0].agent.id, 'a-finance');
  assert.equal(agentTasks([task({ assignee: 'atlas' })], AGENTS).length, 1, 'case-insensitive');
  assert.equal(agentTasks([task({ status: 'in-progress' }), task({ id: 't2', status: 'done' })], AGENTS).length, 0);
  assert.equal(agentTasks([task({ assignee: 'Kofi (a person)' }), task({ id: 't3', assignee: '' })], AGENTS).length, 0, 'people are not agents');
});

test('each automation defaults on and can be turned off on its own', () => {
  assert.deepEqual(resolveAutomations(undefined), { ticketTriage: true, leadFollowUp: true, overdueInvoices: true, agentTasks: true });
  assert.equal(resolveAutomations({ leadFollowUp: false }).leadFollowUp, false);
  assert.equal(resolveAutomations({ leadFollowUp: false }).ticketTriage, true);
});

test('the ledger is bounded, tolerates bad data and enforces the daily cap', () => {
  assert.deepEqual(normalizeLedger(null), emptyLedger());
  assert.deepEqual(normalizeLedger({ done: 5 as unknown as Record<string, number>, runsToday: 'x' as unknown as number }).done, {});
  const big = { ...emptyLedger(), done: Object.fromEntries(Array.from({ length: 700 }, (_, i) => [`k${i}`, i])) };
  const pruned = pruneLedger(big, 600);
  assert.equal(Object.keys(pruned.done).length, 600);
  assert.ok(pruned.done.k699 !== undefined && pruned.done.k0 === undefined, 'newest kept');
  const full = { ...emptyLedger(), day: '2026-10-10', runsToday: MAX_RUNS_PER_DAY };
  assert.equal(withinDailyCap(full, '2026-10-10').ok, false);
  const next = withinDailyCap(full, '2026-10-11');
  assert.ok(next.ok && next.ledger.runsToday === 0, 'a new day resets the count');
});

test('goals name the tools and keep sending with a person', () => {
  const t = ticketGoal({ id: 'SUP-3', subject: 'Cannot log in', priority: 'high', requesterEmail: 'a@b.co' });
  assert.ok(t.includes('SUP-3') && t.includes('update_ticket') && t.includes('draft_ticket_reply') && t.includes('cannot email'));
  const l = leadGoal(staleLeads([lead({ createdAt: daysAgo(5) })], NOW, {})[0], 'Atlas');
  assert.ok(l.includes('create_task') && l.includes('Atlas') && l.includes('Do not send'));
  const i = invoiceGoal(overdueInvoices([inv({})], NOW)[0]);
  assert.ok(i.includes('INV-1') && i.includes('do not change the invoice') && i.includes('Do not send it'));
  const k = taskGoal(task({ detail: 'x'.repeat(2000) }));
  assert.ok(k.includes('update_task') && k.length < 1200, 'long details are clipped');
});

import { parseToolCalls } from './borga/tool-parse';

test('tool calls are read however the model spells them, and broken ones are skipped', () => {
  const plain = parseToolCalls('Plan.\n<tool_call>{"tool":"list_tickets","params":{"status":"open"}}</tool_call>');
  assert.deepEqual(plain, [{ tool: 'list_tickets', params: { status: 'open' } }]);
  assert.deepEqual(parseToolCalls('<tool_call>\n```json\n{"name":"update_ticket","arguments":{"id":"SUP-1"}}\n```\n</tool_call>'), [{ tool: 'update_ticket', params: { id: 'SUP-1' } }], 'fenced, name/arguments');
  const two = parseToolCalls('<tool_call>{"tool":"a","params":{}} {"tool":"b","params":{"x":"}"}}</tool_call>');
  assert.deepEqual(two.map((c) => c.tool), ['a', 'b'], 'two calls in one block, braces inside strings');
  assert.deepEqual(parseToolCalls('<tool_call>{"tool":"cut_off","params":{"a":1}}'), [{ tool: 'cut_off', params: { a: 1 } }], 'answer ended before the closing tag');
  assert.deepEqual(parseToolCalls('<tool_call>{"tool": oops}</tool_call>'), [], 'malformed is skipped, not thrown');
  assert.deepEqual(parseToolCalls('no calls here'), []);
  assert.deepEqual(parseToolCalls('<tool_call>{"tool":"x"}</tool_call>'), [{ tool: 'x', params: {} }], 'missing params');
});

import { MAX_TRIES, RETRY_AFTER_MS, shouldRetry } from './borga/automation-core';

test('tasks an agent created are never handed back to an agent (that would loop)', () => {
  assert.equal(agentTasks([task({ source: 'agent' })], AGENTS).length, 0);
  assert.equal(agentTasks([task({})], AGENTS).length, 1);
});

test('a failed run is retried after a pause and only a few times; a good or running one never', () => {
  const led = { ...emptyLedger(), done: { k: NOW - RETRY_AFTER_MS - 1 }, jobs: { k: { id: 'job-1', tries: 1 } } };
  assert.equal(shouldRetry(led, 'k', NOW, 'error'), true);
  assert.equal(shouldRetry(led, 'k', NOW, 'complete'), false);
  assert.equal(shouldRetry(led, 'k', NOW, 'running'), false);
  assert.equal(shouldRetry(led, 'k', NOW, null), false, 'unknown job: leave it');
  assert.equal(shouldRetry({ ...led, done: { k: NOW - 1000 } }, 'k', NOW, 'error'), false, 'too soon');
  assert.equal(shouldRetry({ ...led, jobs: { k: { id: 'job-1', tries: MAX_TRIES } } }, 'k', NOW, 'error'), false, 'out of tries');
  assert.equal(shouldRetry(led, 'other', NOW, 'error'), false, 'never dispatched');
});
