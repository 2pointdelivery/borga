import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BUSINESS_HOURS,
  DEFAULT_SLA_POLICIES,
  computeSla,
  dueAtMs,
  elapsedMs,
  isAutomatedMail,
  normalizeSubject,
  stripQuotedReply,
  ticketInsights,
  tokenFromSubject,
  type BusinessHours,
} from './borga/tickets';

const MIN = 60_000;
const HOUR = 60 * MIN;
const bh: BusinessHours = { ...DEFAULT_BUSINESS_HOURS }; // Mon-Fri 09:00-17:00 UTC
const at = (iso: string) => new Date(iso).getTime();

// 2026-09-28 is a Monday.
test('24x7 clock counts wall time', () => {
  assert.equal(elapsedMs(at('2026-09-28T10:00:00Z'), at('2026-09-28T12:30:00Z'), [], null, 0), 150 * MIN);
});

test('business-hours clock skips nights and weekends', () => {
  // Fri 16:00 -> Mon 10:00 = 1h Friday + 1h Monday
  const e = elapsedMs(at('2026-09-25T16:00:00Z'), at('2026-09-28T10:00:00Z'), [], bh, 0);
  assert.equal(e, 2 * HOUR);
});

test('business-hours clock honours a UTC offset', () => {
  const plus2: BusinessHours = { ...bh, utcOffsetMin: 120 }; // 09:00 local = 07:00 UTC
  assert.equal(elapsedMs(at('2026-09-28T07:00:00Z'), at('2026-09-28T08:00:00Z'), [], plus2, 0), HOUR);
  assert.equal(elapsedMs(at('2026-09-28T05:00:00Z'), at('2026-09-28T06:59:00Z'), [], plus2, 0), 0);
});

test('pauses are excluded, open pauses run to now', () => {
  const start = at('2026-09-28T09:00:00Z');
  const closed = [{ from: '2026-09-28T10:00:00Z', to: '2026-09-28T11:00:00Z' }];
  assert.equal(elapsedMs(start, at('2026-09-28T12:00:00Z'), closed, bh, 0), 2 * HOUR);
  const open = [{ from: '2026-09-28T10:00:00Z' }];
  assert.equal(elapsedMs(start, at('2026-09-28T12:00:00Z'), open, bh, at('2026-09-28T12:00:00Z')), HOUR);
});

test('dueAt rolls over the weekend and is null while paused', () => {
  // 2h target starting Fri 16:00 -> 1h Fri + 1h Mon => Mon 10:00
  assert.equal(dueAtMs(at('2026-09-25T16:00:00Z'), 120, [], bh), at('2026-09-28T10:00:00Z'));
  assert.equal(dueAtMs(at('2026-09-28T09:00:00Z'), 60, [{ from: '2026-09-28T09:30:00Z' }], bh), null);
});

test('computeSla walks running -> at-risk -> breached, then met / met-late', () => {
  const policy = DEFAULT_SLA_POLICIES[1]; // 24x7; medium: 2h response, 12h resolution
  const base = { createdAt: '2026-09-28T00:00:00Z', firstResponseAt: null, resolvedAt: null, status: 'open' as const, pauses: [], priority: 'medium' as const };
  assert.equal(computeSla(base, policy, bh, at('2026-09-28T01:00:00Z')).response.state, 'running');
  assert.equal(computeSla(base, policy, bh, at('2026-09-28T01:45:00Z')).response.state, 'at-risk');
  assert.equal(computeSla(base, policy, bh, at('2026-09-28T02:01:00Z')).response.state, 'breached');
  const replied = { ...base, firstResponseAt: '2026-09-28T01:00:00Z' };
  assert.equal(computeSla(replied, policy, bh, at('2026-09-28T05:00:00Z')).response.state, 'met');
  const late = { ...base, firstResponseAt: '2026-09-28T03:00:00Z' };
  assert.equal(computeSla(late, policy, bh, at('2026-09-28T05:00:00Z')).response.state, 'met-late');
});

test('pending status pauses the resolution clock', () => {
  const policy = DEFAULT_SLA_POLICIES[1];
  const t = { createdAt: '2026-09-28T00:00:00Z', firstResponseAt: '2026-09-28T00:10:00Z', resolvedAt: null, status: 'pending' as const, pauses: [{ from: '2026-09-28T01:00:00Z' }], priority: 'medium' as const };
  const s = computeSla(t, policy, bh, at('2026-09-29T00:00:00Z'));
  assert.equal(s.resolution.state, 'paused');
  assert.equal(s.resolution.elapsedMin, 60);
  assert.equal(s.resolution.dueAt, null);
});

test('subject tokens and normalisation', () => {
  assert.deepEqual(tokenFromSubject('Re: [SUP-42] Printer down'), { prefix: 'SUP', number: 42 });
  assert.equal(tokenFromSubject('no token here'), null);
  assert.equal(normalizeSubject('RE: Fwd: [SUP-42] Printer down'), 'Printer down');
});

test('quoted reply history is stripped', () => {
  const body = 'Thanks, that fixed it.\n\nOn Mon, 28 Sep 2026 at 10:00, Support <s@x.com> wrote:\n> Have you tried turning it off?\n';
  assert.equal(stripQuotedReply(body), 'Thanks, that fixed it.');
  assert.equal(stripQuotedReply('> only quoted'), '');
});

test('automated mail is recognised', () => {
  assert.equal(isAutomatedMail({}, 'mailer-daemon@x.com'), true);
  assert.equal(isAutomatedMail({ 'auto-submitted': 'auto-replied' }, 'a@x.com'), true);
  assert.equal(isAutomatedMail({ precedence: 'bulk' }, 'a@x.com'), true);
  assert.equal(isAutomatedMail({ 'list-id': '<x.list>' }, 'a@x.com'), true);
  assert.equal(isAutomatedMail({ 'auto-submitted': 'no' }, 'a@x.com'), false);
  assert.equal(isAutomatedMail({}, 'customer@x.com'), false);
});

// Per-ticket insights: every line must come from the ticket's own fields.

const premium = DEFAULT_SLA_POLICIES[1]; // 24x7
const insightTicket = (p: Record<string, unknown>) => ({
  status: 'open' as const,
  priority: 'medium' as const,
  assignee: 'Amy',
  createdAt: '2026-09-28T10:00:00Z',
  updatedAt: '2026-09-28T11:00:00Z',
  firstResponseAt: '2026-09-28T10:30:00Z',
  resolvedAt: null,
  reopenCount: 0,
  source: 'web' as const,
  requesterEmail: 'c@x.com',
  comments: [],
  ...p,
});

test('a critical unowned ticket with a breached first response leads with danger', () => {
  const t = insightTicket({ priority: 'critical', assignee: '', firstResponseAt: null, updatedAt: '2026-09-28T11:00:00Z' });
  const now = at('2026-09-28T12:00:00Z'); // 60m after creation vs 15m critical response target
  const out = ticketInsights(t, computeSla({ ...t, pauses: [] }, premium, bh, now), now);
  assert.ok(out.length > 0);
  assert.equal(out[0].tone, 'danger');
  assert.ok(out.some((i) => i.text.includes('unowned')), JSON.stringify(out));
  assert.ok(out.some((i) => i.text.includes('First response breached')), JSON.stringify(out));
});

test('reopens and idle time are called out with the action they imply', () => {
  const t = insightTicket({ reopenCount: 2, updatedAt: '2026-09-24T11:00:00Z' });
  const now = at('2026-09-28T12:00:00Z');
  const out = ticketInsights(t, computeSla({ ...t, pauses: [] }, premium, bh, now), now);
  assert.ok(out.some((i) => i.text.includes('Reopened 2×')), JSON.stringify(out));
  assert.ok(out.some((i) => i.text.includes('No movement in 4d')), JSON.stringify(out));
});

test('a resolved-over-SLA ticket suggests a retro, and pending names the wait', () => {
  const late = insightTicket({ status: 'resolved' as const, firstResponseAt: '2026-09-28T13:00:00Z', resolvedAt: '2026-09-28T23:30:00Z', createdAt: '2026-09-28T10:00:00Z' });
  const outLate = ticketInsights(late, computeSla({ ...late, pauses: [] }, premium, bh, at('2026-09-29T00:00:00Z')), at('2026-09-29T00:00:00Z'));
  assert.ok(outLate.some((i) => i.text.includes('retro')), JSON.stringify(outLate));
  const pending = insightTicket({ status: 'pending' as const, updatedAt: '2026-09-28T09:00:00Z' });
  const outPending = ticketInsights(pending, computeSla({ ...pending, pauses: [] }, premium, bh, at('2026-09-28T12:00:00Z')), at('2026-09-28T12:00:00Z'));
  assert.ok(outPending.some((i) => i.text.includes('Waiting on the customer')), JSON.stringify(outPending));
});

test('an email ticket without a requester address warns about delivery', () => {
  const t = insightTicket({ source: 'email' as const, requesterEmail: '' });
  const now = at('2026-09-28T12:00:00Z');
  const out = ticketInsights(t, computeSla({ ...t, pauses: [] }, premium, bh, now), now);
  assert.ok(out.some((i) => i.text.includes('cannot be delivered')), JSON.stringify(out));
});

test('insights are danger-first and capped', () => {
  const t = insightTicket({ priority: 'critical' as const, assignee: '', firstResponseAt: null, reopenCount: 3, source: 'email' as const, requesterEmail: '', status: 'pending' as const, updatedAt: '2026-09-20T10:00:00Z' });
  const now = at('2026-09-28T12:00:00Z');
  const out = ticketInsights(t, computeSla({ ...t, pauses: [] }, premium, bh, now), now);
  assert.ok(out.length <= 5);
  const rank = { danger: 0, warn: 1, info: 2 };
  assert.deepEqual(out.map((i) => rank[i.tone]), [...out.map((i) => rank[i.tone])].sort((a, b) => a - b));
});
