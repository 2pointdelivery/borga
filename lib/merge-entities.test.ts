import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCustomerMerge, applyLeadMerge } from './borga/merge-entities';

const lead = (over: Record<string, unknown> = {}) => ({
  id: 'l-a', name: 'Ama Serwaa', company: 'Accra Foods', email: '', phone: '+2331',
  value: 0, stage: 'new', source: 'Web', ownerId: 'a-sales', priority: 'P1',
  ...over,
});

test('lead merge fills blanks, moves quotes, deletes the loser', () => {
  const lists = {
    leads: [lead(), lead({ id: 'l-b', email: 'ama@accra.test', value: 5000, source: 'Referral' })],
    quotes: [{ id: 'q-1', leadId: 'l-b' }],
  };
  const r = applyLeadMerge(lists as never, 'l-a', 'l-b');
  assert.ok(r);
  assert.equal(r.leads.length, 1);
  assert.equal(r.leads[0].email, 'ama@accra.test');
  assert.equal(r.leads[0].value, 5000);
  assert.equal(r.leads[0].phone, '+2331', 'winner keeps its own phone');
  assert.equal(r.leads[0].stage, 'new', 'winner keeps its stage');
  assert.equal(r.quotes[0].leadId, 'l-a');
});

test('lead merge refuses self-merge and missing ids', () => {
  const lists = { leads: [lead()], quotes: [] };
  assert.equal(applyLeadMerge(lists as never, 'l-a', 'l-a'), null);
  assert.equal(applyLeadMerge(lists as never, 'l-a', 'missing'), null);
  assert.equal(applyLeadMerge(lists as never, 'missing', 'l-a'), null);
});

const customer = (over: Record<string, unknown> = {}) => ({
  id: 'c-a', name: 'Acme', industry: '', website: '', email: '', phone: '',
  addressLine: '', city: '', country: '', status: 'prospect', owner: '', createdAt: 'x', notes: '',
  ...over,
});

test('customer merge moves every linked record and re-points name-matched invoices', () => {
  const lists = {
    customers: [customer(), customer({ id: 'c-b', email: 'ops@acme.test', phone: '123' })],
    leads: [{ id: 'l-1', customerId: 'c-b' }],
    quotes: [{ id: 'q-1', customerId: 'c-b' }],
    invoices: [
      { id: 'in-1', customerId: 'c-b', client: 'Acme' },
      { id: 'in-2', client: 'Acme' },
      { id: 'in-3', client: 'Someone Else' },
    ],
    projects: [{ id: 'p-1', customerId: 'c-b' }],
    contacts: [{ id: 'ct-1', customerId: 'c-b' }],
  };
  const r = applyCustomerMerge(lists as never, 'c-a', 'c-b');
  assert.ok(r);
  assert.equal(r.customers.length, 1);
  assert.equal(r.customers[0].email, 'ops@acme.test');
  assert.equal(r.customers[0].phone, '123');
  for (const k of ['leads', 'quotes', 'projects', 'contacts'] as const) {
    assert.ok((r[k] as Array<{ customerId?: string }>).every((x) => x.customerId !== 'c-b'), k);
  }
  const inv = r.invoices as Array<{ id: string; customerId?: string }>;
  assert.equal(inv.find((i) => i.id === 'in-1')?.customerId, 'c-a');
  assert.equal(inv.find((i) => i.id === 'in-2')?.customerId, 'c-a', 'name-matched invoice re-pointed');
  assert.equal(inv.find((i) => i.id === 'in-3')?.customerId, undefined, 'unrelated invoice untouched');
});

test('customer merge refuses self-merge and missing ids', () => {
  const lists = { customers: [customer()], leads: [], quotes: [], invoices: [], projects: [], contacts: [] };
  assert.equal(applyCustomerMerge(lists as never, 'c-a', 'c-a'), null);
  assert.equal(applyCustomerMerge(lists as never, 'c-a', 'missing'), null);
});
