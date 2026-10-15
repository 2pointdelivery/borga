import test from 'node:test';
import assert from 'node:assert/strict';
import { collectTimeline, type TimelineData } from './borga/timeline';

const data: TimelineData = {
  leads: [{ id: 'l-1', name: 'Ama', company: 'Acme', customerId: 'c-1', stage: 'won', value: 5000, source: 'Web', createdAt: '2026-09-01T00:00:00.000Z' }],
  customers: [{ id: 'c-1', name: 'Acme' }],
  quotes: [{ id: 'q-1', number: 'Q-7', customerId: 'c-1', customerName: 'Acme', leadId: 'l-1', status: 'converted', issued: '2026-09-05', convertedInvoiceId: 'in-1', convertedProjectId: 'p-1' }],
  invoices: [{ id: 'in-1', number: 'INV-9', client: 'Acme', customerId: 'c-1', amount: 5000, status: 'sent', issued: '2026-09-06', externalRef: 'quote:q-1:v1', projectId: 'p-1' }],
  projects: [{ id: 'p-1', name: 'Acme rollout', customerId: 'c-1', status: 'active', createdAt: '2026-09-07T00:00:00.000Z' }],
  activity: [{ id: 'e-1', time: '10:00', agentId: 'a', agentName: 'Ag', actor: 'user', kind: 'task', message: 'Called them', ref: { kind: 'lead', id: 'l-1' } }],
};

test('a lead timeline walks the whole chain newest-first, then activity', () => {
  const t = collectTimeline(data, { kind: 'lead', id: 'l-1' });
  assert.deepEqual(t.map((e) => e.kind), ['project', 'invoice', 'quote', 'lead', 'customer', 'note']);
  assert.ok(t[0].title.includes('Acme rollout'));
  assert.ok(t[t.length - 1].title.includes('Called them'));
});

test('a customer timeline gathers deals, quotes, invoices and projects', () => {
  const kinds = collectTimeline(data, { kind: 'customer', id: 'c-1' }).map((e) => e.kind);
  assert.ok(kinds.includes('lead') && kinds.includes('quote') && kinds.includes('invoice') && kinds.includes('project'));
});

test('a quote timeline links back to its lead and forward to invoice and project', () => {
  const titles = collectTimeline(data, { kind: 'quote', id: 'q-1' }).map((e) => e.title).join(' | ');
  assert.ok(titles.includes('Ama') && titles.includes('INV-9') && titles.includes('Acme rollout'));
});

test('an invoice timeline walks back through its quote ref', () => {
  const titles = collectTimeline(data, { kind: 'invoice', id: 'in-1' }).map((e) => e.title).join(' | ');
  assert.ok(titles.includes('Q-7'));
});

test('unknown ids yield nothing, never throw', () => {
  assert.deepEqual(collectTimeline(data, { kind: 'lead', id: 'missing' }), []);
  assert.deepEqual(collectTimeline({ leads: [], customers: [], quotes: [], invoices: [], projects: [], activity: [] }, { kind: 'customer', id: 'c-1' }), []);
});
