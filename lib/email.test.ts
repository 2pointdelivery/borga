import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_EMAIL_SETTINGS,
  buildDigestModel,
  digestPeriodKey,
  eventDedupeKey,
  fmtMoney,
  localClock,
  makeUnsubToken,
  mergeSettings,
  normalizeRecipients,
  readUnsubToken,
  renderDigest,
  renderEvent,
  renderTest,
  type DigestInput,
  type MailContext,
} from './borga/email-core';

const ctx: MailContext = { workspaceName: 'Acme <Co>', accent: '#0ea5e9', appUrl: 'https://borga.example.com', unsubscribeUrl: 'https://borga.example.com/u?t=1' };

test('recipients are validated, lower-cased, de-duplicated and capped', () => {
  assert.deepEqual(normalizeRecipients(['A@x.com', 'a@x.com', 'bad', ' b@y.org ', 'x@y', 'c d@z.com']), ['a@x.com', 'b@y.org']);
  assert.equal(normalizeRecipients(Array.from({ length: 30 }, (_, i) => `u${i}@x.com`)).length, 10);
  assert.deepEqual(normalizeRecipients('nope'), []);
});

test('settings merge keeps defaults, clamps the digest hour and never trusts bad recipients', () => {
  const s = mergeSettings({ enabled: true, recipients: ['ok@x.com', 'evil'], digest: { frequency: 'weekly', hour: 99, skipIfEmpty: false }, events: { sla_breach: false } as never });
  assert.equal(s.enabled, true);
  assert.deepEqual(s.recipients, ['ok@x.com']);
  assert.equal(s.digest.hour, 23);
  assert.equal(s.events.sla_breach, false);
  assert.equal(s.events.ticket_new, true);
  assert.equal(mergeSettings(null).enabled, false);
  assert.deepEqual(mergeSettings(undefined), DEFAULT_EMAIL_SETTINGS);
});

test('unsubscribe tokens round-trip and reject tampering or a different secret', () => {
  const t = makeUnsubToken('s3cret', 'user-1', 'ws-a', 'Person@X.com');
  assert.deepEqual(readUnsubToken('s3cret', t), { userId: 'user-1', ws: 'ws-a', email: 'person@x.com' });
  assert.equal(readUnsubToken('other', t), null);
  const [p, m] = t.split('.');
  assert.equal(readUnsubToken('s3cret', `${Buffer.from('user-2|ws-a|person@x.com').toString('base64url')}.${m}`), null);
  assert.equal(readUnsubToken('s3cret', `${p}.AAAA`), null);
  assert.equal(readUnsubToken('s3cret', 'garbage'), null);
});

test('every dynamic value is HTML-escaped (no script injection from ticket or approval text)', () => {
  const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>';
  const mails = [
    renderEvent('ticket_new', { ticketId: 'SUP-1', subject: evil, from: evil }, ctx),
    renderEvent('approval_requested', { id: 'a', title: evil, description: evil, submittedBy: evil, amount: 50 }, ctx),
    renderEvent('agent_urgent', { title: evil, body: evil }, ctx),
    renderEvent('sla_breach', { ticketId: 'SUP-2', subject: evil, priority: evil, which: evil }, ctx),
    renderEvent('recurring_invoices', { numbers: [evil, '#2200'] }, ctx),
  ];
  for (const m of mails) {
    assert.ok(!/<script|<img/i.test(m.html), m.subject);
    assert.ok(m.html.includes('&lt;'), 'escaped text present');
  }
  assert.ok(renderTest(ctx).html.includes('Acme &lt;Co&gt;'));
  assert.ok(!/[\r\n]/.test(mails[0].subject), 'subjects cannot carry header-injection newlines');
  assert.ok(!/[\r\n]/.test(renderEvent('ticket_new', { ticketId: 'S', subject: 'a\r\nBcc: x@evil.test', from: '' }, ctx).subject));
});

test('mails carry a plain-text part, the workspace name, a CTA and the unsubscribe link', () => {
  const m = renderEvent('approval_requested', { id: 'ap1', title: 'Pay vendor', description: 'Held by autonomous mode', submittedBy: 'Sage', amount: 6000 }, ctx, 'USD');
  assert.match(m.subject, /^\[Acme <Co>\] Approval needed: Pay vendor$/);
  assert.match(m.text, /Amount: \$6,000\.00/);
  assert.match(m.text, /Open Borga|Review the approval: https:\/\/borga\.example\.com\/app/);
  assert.match(m.html, /Unsubscribe/);
  assert.match(m.html, /href="https:\/\/borga\.example\.com\/app"/);
  const noUrl = renderEvent('approval_requested', { id: 'ap1', title: 't', description: '', submittedBy: 's', amount: 0 }, { ...ctx, appUrl: undefined, unsubscribeUrl: undefined });
  assert.ok(!noUrl.html.includes('<a href'), 'no links when the public URL is unknown');
});

test('dedupe keys are stable per underlying thing', () => {
  assert.equal(eventDedupeKey('approval_requested', { id: 'ap-9' }), 'approval_requested:ap-9');
  assert.equal(eventDedupeKey('sla_breach', { ticketId: 'SUP-3', which: 'resolution' }), 'sla_breach:SUP-3:resolution');
  assert.notEqual(eventDedupeKey('sla_breach', { ticketId: 'SUP-3', which: 'first response' }), eventDedupeKey('sla_breach', { ticketId: 'SUP-3', which: 'resolution' }));
  assert.equal(eventDedupeKey('recurring_bills', { numbers: ['BILL-1', 'BILL-2'] }), 'recurring_bills:BILL-1,BILL-2');
});

const digestInput = (over: Partial<DigestInput> = {}): DigestInput => ({
  todayIso: '2026-10-15',
  currency: 'USD',
  invoices: [
    { number: '#2200', client: 'Acme', amount: 1200, due: '2026-10-01', status: 'sent' },
    { number: '#2201', client: 'Beta', amount: 300, due: '2026-10-20', status: 'sent' },
    { number: '#2202', client: 'Void', amount: 999, due: '2026-09-01', status: 'sent', voidedAt: 'x' },
    { number: '#2203', client: 'Paid', amount: 50, due: '2026-09-01', status: 'paid' },
    { number: '#2204', client: 'Legacy', amount: 70, due: 'Sep 05', status: 'sent' },
  ],
  bills: [
    { number: 'BILL-1', vendorName: 'Rent', amount: 2000, due: '2026-10-10', status: 'unpaid' },
    { number: 'BILL-2', vendorName: 'SaaS', amount: 99, due: '2026-10-18', status: 'unpaid' },
    { number: 'BILL-3', vendorName: 'Later', amount: 5, due: '2026-12-01', status: 'unpaid' },
    { number: 'BILL-4', vendorName: 'Done', amount: 7, due: '2026-10-01', status: 'paid' },
  ],
  approvals: [{ title: 'Pay Rent', amount: 2000, status: 'pending', submittedBy: 'Sage' }, { title: 'Old', amount: 1, status: 'approved', submittedBy: 'x' }],
  tickets: { open: 4, breached: 1, atRisk: 2, unassigned: 3 },
  finance: [
    { amount: 5000, kind: 'revenue', dateIso: '2026-10-03' },
    { amount: 400, kind: 'expense', dateIso: '2026-10-04' },
    { amount: 9999, kind: 'revenue', dateIso: '2026-09-30' },
    { amount: 777, kind: 'revenue', dateIso: '2026-10-05', voidedAt: 'x' },
  ],
  ...over,
});

test('digest model finds overdue invoices, bills due, approvals, and month totals; ignores void/paid/unparseable', () => {
  const m = buildDigestModel(digestInput());
  assert.equal(m.overdueInvoices.count, 1);
  assert.equal(m.overdueInvoices.total, 1200);
  assert.equal(m.overdueInvoices.top[0].label, '#2200 · Acme');
  assert.deepEqual([m.billsDue.overdue, m.billsDue.soon, m.billsDue.total], [1, 1, 2099]);
  assert.equal(m.approvals.count, 1);
  assert.deepEqual(m.month, { revenue: 5000, expenses: 400 });
  assert.equal(m.needsAttention, true);
});

test('a quiet workspace is "all clear" and the digest renders both ways', () => {
  const quiet = buildDigestModel(digestInput({ invoices: [], bills: [], approvals: [], tickets: { open: 0, breached: 0, atRisk: 0, unassigned: 0 } }));
  assert.equal(quiet.needsAttention, false);
  const mail = renderDigest(quiet, ctx, 'USD', 'daily', 'Thu 15 Oct');
  assert.match(mail.subject, /all clear/);
  const busy = renderDigest(buildDigestModel(digestInput()), ctx, 'USD', 'weekly', 'Mon 12 Oct');
  assert.match(busy.subject, /Weekly update: items need attention/);
  assert.match(busy.text, /Overdue invoices \(1, \$1,200\.00\)/);
  assert.match(busy.text, /#2200 · Acme \(due 2026-10-01\): \$1,200\.00/);
});

test('digest timing honours the company timezone, hour, frequency and weekday', () => {
  const d = { frequency: 'daily' as const, hour: 8, skipIfEmpty: true };
  const t = new Date('2026-10-15T14:30:00Z'); // 08:30 in Chicago (CDT), 14:30 UTC
  assert.equal(localClock(t, 'America/Chicago').hour, 9);
  assert.equal(digestPeriodKey(d, new Date('2026-10-15T11:59:00Z'), 'America/Chicago'), null); // 06:59 local
  assert.equal(digestPeriodKey(d, new Date('2026-10-15T13:00:00Z'), 'America/Chicago'), 'day:2026-10-15'); // 08:00 local
  assert.equal(digestPeriodKey({ ...d, frequency: 'off' }, t, 'UTC'), null);
  assert.equal(digestPeriodKey({ ...d, frequency: 'weekly' }, new Date('2026-10-15T14:00:00Z'), 'UTC'), null); // Thursday
  assert.equal(digestPeriodKey({ ...d, frequency: 'weekly' }, new Date('2026-10-12T14:00:00Z'), 'UTC'), 'week:2026-10-12'); // Monday
  assert.equal(localClock(t, 'Not/AZone').dateIso, '2026-10-15'); // bad zone falls back
  assert.match(fmtMoney(1234.5, 'USD'), /\$1,234\.50/);
});
