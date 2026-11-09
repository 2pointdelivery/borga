import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPLEE_API_BASE, EXPLEE_HOT_LEADS_PATH, hotLeadsUrl, expleeHeaders, parseHotLeads, parseProjects,
  normalizeHotLead, hotLeadToLead, mergeHotLeads, nextCursor, type ExpleeHotLead,
} from './borga/explee-core';
import type { Lead } from './borga/data';

const hot = (o: Partial<ExpleeHotLead> = {}): ExpleeHotLead => ({
  person_id: 'p-1', campaign_id: 77, name: 'Jane Doe', email: 'jane@acme.test', job_title: 'CTO',
  company_name: 'Acme', company_domain: 'acme.test', linkedin_url: 'https://linkedin.com/in/janedoe',
  country: 'GB', phone: '+44 20 1234 5678', why_hot: 'This is interesting, let us talk Tuesday.',
  became_hot_at: '2026-10-01T12:00:00Z', ...o,
});

test('hot-leads URL carries since, limit and offset; since is normalised, garbage dropped', () => {
  assert.ok(hotLeadsUrl(null).startsWith(EXPLEE_API_BASE + EXPLEE_HOT_LEADS_PATH));
  assert.ok(!hotLeadsUrl(null).includes('since='));
  const u = new URL(hotLeadsUrl('2026-10-01T12:00:00Z', 200, 500));
  assert.equal(u.searchParams.get('since'), '2026-10-01T12:00:00.000Z');
  assert.equal(u.searchParams.get('limit'), '200');
  assert.equal(u.searchParams.get('offset'), '200');
  assert.ok(!new URL(hotLeadsUrl('not a date')).searchParams.has('since'));
});

test('headers always carry the X-API-Key', () => {
  assert.deepEqual(expleeHeaders('sk_explee_x'), { Accept: 'application/json', 'X-API-Key': 'sk_explee_x' });
});

test('hot leads parse from the documented shape, a bare array, and skip skeletons', () => {
  const a = parseHotLeads({ leads: [hot()], total: 1, has_more: false, next_offset: null });
  assert.equal(a.leads.length, 1);
  assert.equal(a.hasMore, false);
  const b = parseHotLeads({ leads: [hot()], has_more: true, next_offset: 50 });
  assert.deepEqual([b.hasMore, b.nextOffset], [true, 50]);
  assert.equal(parseHotLeads([hot()]).leads.length, 1);
  assert.equal(parseHotLeads({ message: 'nope' }).leads.length, 0);
  assert.equal(normalizeHotLead({ email: 'x@y.test', person_id: null })?.person_id, 'x@y.test');
  assert.equal(normalizeHotLead({ campaign_id: 1 }), null);
});

test('projects parse for the connection test', () => {
  const p = parseProjects({ projects: [{ id: 42836, domain: '2pointlogistics.com' }], total: 1 });
  assert.deepEqual(p, [{ id: 42836, domain: '2pointlogistics.com' }]);
  assert.equal(parseProjects([{}]).length, 0);
});

test('a hot lead maps to a qualified P1 lead with the reply kept verbatim', () => {
  const l = hotLeadToLead(hot(), '2026-10-02T00:00:00Z');
  assert.equal(l?.stage, 'qualified');
  assert.equal(l?.priority, 'P1');
  assert.equal(l?.source, 'Explee');
  assert.equal(l?.email, 'jane@acme.test');
  assert.equal(l?.company, 'Acme');
  assert.equal(l?.hotWhy, 'This is interesting, let us talk Tuesday.');
  assert.equal(l?.createdAt, '2026-10-01T12:00:00Z');
  assert.equal(l?.explee?.jobTitle, 'CTO');
  assert.equal(l?.explee?.campaignId, '77');
  assert.equal(hotLeadToLead(hot({ erased: true }), '2026-10-02T00:00:00Z'), null);
  assert.equal(hotLeadToLead(hot({ name: null, email: null }), '2026-10-02T00:00:00Z'), null);
  assert.equal(hotLeadToLead(hot({ name: null, email: 'named@acme.test' }), '2026-10-02T00:00:00Z')?.name, 'named@acme.test');
});

const bare = (o: Partial<Lead>): Lead => ({
  id: 'l', name: 'N', company: 'C', email: '', phone: '', value: 0, stage: 'new',
  source: 'Manual entry', ownerId: 'a-sales', priority: 'P2', ...o,
});

test('merging adds once, updates contact fields, and never resets a stage the team set', () => {
  const incoming = hotLeadToLead(hot({ why_hot: 'Reply v2', became_hot_at: '2026-10-02T09:00:00Z' }), '2026-10-02T00:00:00Z')!;
  const first = mergeHotLeads([], [incoming]);
  assert.deepEqual(first.summary, { added: 1, updated: 0, unchanged: 0, addedIds: [incoming.id] });

  const second = mergeHotLeads(first.next, [incoming]);
  assert.equal(second.summary.added, 0);

  const moved = mergeHotLeads([bare({ ...first.next[0], stage: 'proposal', ownerId: 'a-ops', value: 5000 })], [incoming]);
  assert.equal(moved.summary.added, 0);
  assert.equal(moved.next[0].stage, 'proposal');
  assert.equal(moved.next[0].ownerId, 'a-ops');
  assert.equal(moved.next[0].value, 5000);
  assert.equal(moved.next[0].hotWhy, 'Reply v2');

  const byEmail = mergeHotLeads([bare({ email: 'jane@acme.test', company: 'Acme', name: 'Jane D.' })], [incoming]);
  assert.equal(byEmail.summary.added, 0);
  assert.equal(byEmail.summary.updated, 1);
  assert.equal(byEmail.next[0].name, 'Jane Doe');

  const differentCompany = mergeHotLeads([bare({ email: 'jane@acme.test', company: 'OtherCorp' })], [incoming]);
  assert.equal(differentCompany.summary.added, 1);
});

test('an identical lead coming back through a JSON round-trip is unchanged, not updated', () => {
  const incoming = hotLeadToLead(hot(), '2026-10-02T00:00:00Z')!;
  const { next } = mergeHotLeads([], [incoming]);
  // MySQL's JSON column reorders keys, so equality must not depend on stringify order.
  const shuffled = JSON.parse(JSON.stringify(next[0]), (k, v) => (typeof v === 'object' && v && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v));
  const again = mergeHotLeads([shuffled], [incoming]);
  assert.deepEqual(again.summary, { added: 0, updated: 0, unchanged: 1, addedIds: [] });
});

test('the cursor only moves forward, ignoring undated rows', () => {
  assert.equal(nextCursor([], null), null);
  assert.equal(nextCursor([hot({ became_hot_at: null })], null), null);
  const batch = [hot({ became_hot_at: '2026-10-02T09:00:00Z' }), hot({ person_id: 'p-2', became_hot_at: '2026-10-01T08:00:00Z' })];
  assert.equal(nextCursor(batch, null), '2026-10-02T09:00:00Z');
  assert.equal(nextCursor([hot({ person_id: 'p-3', became_hot_at: '2026-09-01T08:00:00Z' })], '2026-10-02T09:00:00Z'), '2026-10-02T09:00:00Z');
});
