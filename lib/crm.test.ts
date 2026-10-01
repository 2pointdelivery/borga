import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRecords, mapLeadStage, mergeCustomers, mergeLeads, nextPageUrl, normalizeAll, normalizeCustomer, normalizeLead } from './borga/crm-core';
import type { Customer, Lead } from './borga/data';

test('records are found in bare arrays, listKey, and common wrappers', () => {
  assert.equal(extractRecords([{ id: 1 }, 'x', null])?.length, 1);
  assert.equal(extractRecords({ data: [{ id: 1 }, { id: 2 }] })?.length, 2);
  assert.equal(extractRecords({ data: { items: [{ id: 1 }] } })?.length, 1);
  assert.equal(extractRecords({ payload: { rows: [{ id: 1 }] } }, 'payload.rows')?.length, 1);
  assert.equal(extractRecords({ message: 'nope' }), null);
  assert.equal(extractRecords('text'), null);
});

test('pagination only follows the API\'s own origin', () => {
  const cur = 'https://crm.acme.test/api/customers';
  assert.equal(nextPageUrl({ next: '/api/customers?page=2' }, cur), 'https://crm.acme.test/api/customers?page=2');
  assert.equal(nextPageUrl({ links: { next: { href: 'https://crm.acme.test/api/customers?page=3' } } }, cur), 'https://crm.acme.test/api/customers?page=3');
  assert.equal(nextPageUrl({ next: 'https://evil.test/steal' }, cur), null);
  assert.equal(nextPageUrl({ next: cur }, cur), null);
  assert.equal(nextPageUrl({ data: [] }, cur), null);
});

test('customers normalise from different CRM shapes and skip unusable rows', () => {
  const a = normalizeCustomer({ id: 7, company_name: 'Acme Ltd', email_address: 'ops@acme.test', phone_number: '+1 555', address: { city: 'Accra', country: 'GH', street: '1 Main St' }, lifecycle_stage: 'Customer' });
  assert.equal(a?.crmId, '7');
  assert.equal(a?.name, 'Acme Ltd');
  assert.equal(a?.city, 'Accra');
  assert.equal(a?.addressLine, '1 Main St');
  assert.equal(a?.status, 'active');
  assert.equal(normalizeCustomer({ id: 'x', name: 'Beta', status: 'Churned' })?.status, 'churned');
  assert.equal(normalizeCustomer({ id: 'y', name: 'Gamma', stage: 'Prospect' })?.status, 'prospect');
  assert.equal(normalizeCustomer({ name: 'No id' }), null);
  assert.equal(normalizeCustomer({ id: 1 }), null);
  const r = normalizeAll([{ id: 1, name: 'A' }, { id: 1, name: 'A again' }, { name: 'bad' }], normalizeCustomer);
  assert.equal(r.records.length, 1);
  assert.equal(r.skipped, 2);
});

test('deal stages and values map sensibly', () => {
  assert.equal(mapLeadStage('Closed Won'), 'won');
  assert.equal(mapLeadStage('closed-lost'), 'lost');
  assert.equal(mapLeadStage('Negotiation'), 'proposal');
  assert.equal(mapLeadStage('Demo scheduled'), 'qualified');
  assert.equal(mapLeadStage('Inbound'), 'new');
  const l = normalizeLead({ deal_id: 'd1', deal_name: 'Fleet contract', amount: '$12,500.50', company: 'Acme', pipeline_stage: 'Proposal sent', lead_source: 'Referral' });
  assert.equal(l?.value, 12500.5);
  assert.equal(l?.stage, 'proposal');
  assert.equal(l?.source, 'Referral');
  assert.equal(normalizeLead({ id: 'z', company: 'OnlyCo' })?.name, 'OnlyCo');
});

const cust = (o: Partial<Customer>): Customer => ({ id: 'c', name: 'N', industry: '', website: '', email: '', phone: '', addressLine: '', city: '', country: '', status: 'active', owner: 'Dana', createdAt: 't', notes: 'mine', ...o });

test('customer merge upserts by CRM id, then email, then name; never erases or touches local-only fields', () => {
  const existing = [cust({ id: 'local1', name: 'Acme Ltd', email: 'ops@acme.test', owner: 'Dana', notes: 'VIP' }), cust({ id: 'local2', name: 'Delta', crmId: 'd-9', city: 'Lagos' })];
  const incoming = [
    { crmId: '7', name: 'Acme Ltd', email: 'OPS@acme.test', phone: '+1', website: '', industry: 'Logistics', addressLine: '', city: '', state: '', country: '', status: 'active' as const },
    { crmId: 'd-9', name: 'Delta', email: '', phone: '', website: '', industry: '', addressLine: '', city: '', state: '', country: '', status: 'active' as const },
    { crmId: 'n-1', name: 'Newco', email: 'hi@newco.test', phone: '', website: '', industry: '', addressLine: '', city: 'Accra', state: '', country: 'GH', status: 'prospect' as const },
  ];
  const { next, summary } = mergeCustomers(existing, incoming, '2026-10-01T00:00:00Z');
  assert.deepEqual(summary, { added: 1, updated: 1, unchanged: 1 });
  const acme = next.find((c) => c.id === 'local1')!;
  assert.equal(acme.crmId, '7');
  assert.equal(acme.industry, 'Logistics');
  assert.equal(acme.owner, 'Dana');
  assert.equal(acme.notes, 'VIP');
  assert.equal(next.find((c) => c.id === 'local2')!.city, 'Lagos'); // empty CRM value did not erase it
  assert.equal(next[0].name, 'Newco');
  // running again is a no-op
  const again = mergeCustomers(next, incoming, '2026-10-02T00:00:00Z');
  assert.deepEqual(again.summary, { added: 0, updated: 0, unchanged: 3 });
});

test('lead merge upserts by CRM id, links customers, and tracks stage changes', () => {
  const customers = [cust({ id: 'cu1', name: 'Acme Ltd', email: 'ops@acme.test' })];
  const inc = [{ crmId: 'd1', name: 'Fleet deal', company: 'Acme Ltd', email: '', phone: '', value: 30000, stage: 'proposal' as const, source: 'CRM' }];
  const first = mergeLeads([], inc, customers);
  assert.equal(first.summary.added, 1);
  assert.equal(first.next[0].customerId, 'cu1');
  assert.equal(first.next[0].priority, 'P0');
  const moved = mergeLeads(first.next, [{ ...inc[0], stage: 'won' as const }], customers);
  assert.deepEqual(moved.summary, { added: 0, updated: 1, unchanged: 0 });
  assert.equal(moved.next[0].stage, 'won');
  assert.deepEqual(mergeLeads(moved.next, [{ ...inc[0], stage: 'won' as const }], customers).summary, { added: 0, updated: 0, unchanged: 1 });
  const lead: Lead = first.next[0];
  assert.equal(lead.ownerId, 'a-sales');
});
