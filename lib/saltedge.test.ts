import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import {
  createSaltEdgeClient, signRequest, ensureCustomer, createConnectSession, listTransactions, listConnections, fetchFeed, mapAccount, mapTransaction,
  refreshConnection, removeConnection, validReturnUrl, SaltEdgeError, SALTEDGE_BASE, type SeTransaction,
} from './borga/saltedge';

interface Call { method: string; url: URL; headers: Record<string, string>; body: unknown }

/** A fake Salt Edge: records every call and answers from a table keyed by "METHOD /path". */
function fake(routes: Record<string, (c: Call) => { status?: number; json: unknown }>) {
  const calls: Call[] = [];
  const f: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const call: Call = { method: String(init?.method ?? 'GET'), url, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const key = `${call.method} ${url.pathname.replace('/api/v6', '')}`;
    const h = routes[key];
    if (!h) return new Response(JSON.stringify({ error: { class: 'NotFound', message: `no route ${key}` } }), { status: 404 });
    const r = h(call);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  };
  return { f, calls };
}
const creds = { appId: 'app123', secret: 'sec456' };

test('every request carries the app credentials, as JSON, and only Live clients add a signature', async () => {
  const { f, calls } = fake({ 'GET /customers': () => ({ json: { data: [] } }) });
  await createSaltEdgeClient(creds, { fetch: f }).request('GET', '/customers', { query: { per_page: 1, from_id: undefined } });
  assert.equal(calls[0].url.origin + calls[0].url.pathname, `${SALTEDGE_BASE}/customers`);
  assert.equal(calls[0].url.searchParams.get('per_page'), '1');
  assert.equal(calls[0].url.searchParams.has('from_id'), false, 'undefined parameters are left out');
  assert.equal(calls[0].headers['App-id'], 'app123');
  assert.equal(calls[0].headers.Secret, 'sec456');
  assert.equal(calls[0].headers.Accept, 'application/json');
  assert.equal(calls[0].headers.Signature, undefined);
  assert.equal(calls[0].headers['Expires-at'], undefined);
});

test('a Live client signs expires_at|METHOD|url|body with RSA-SHA256, and the signature verifies with the public key', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const { f, calls } = fake({ 'POST /customers': () => ({ json: { data: { customer_id: '1' } } }) });
  await createSaltEdgeClient({ ...creds, privateKeyPem: pem }, { fetch: f, now: () => 1_700_000_000_000 }).request('POST', '/customers', { body: { data: { identifier: 'x' } } });
  const c = calls[0];
  assert.equal(c.headers['Expires-at'], '1700000060');
  const signed = `1700000060|POST|${c.url.toString()}|${JSON.stringify({ data: { identifier: 'x' } })}`;
  const ok = createVerify('RSA-SHA256').update(signed).verify(publicKey, c.headers.Signature, 'base64');
  assert.equal(ok, true);
  assert.equal(createVerify('RSA-SHA256').update(signed + 'x').verify(publicKey, c.headers.Signature, 'base64'), false, 'a different request does not verify');
  assert.equal(signRequest(pem, 1, 'get', 'https://x', '').length > 100, true);
});

test('errors carry Salt Edge\'s class, message and request id', async () => {
  const { f } = fake({ 'GET /accounts': () => ({ status: 401, json: { error: { class: 'ApiKeyNotFound', message: 'Wrong keys.', request_id: 'rq1' } } }) });
  await assert.rejects(createSaltEdgeClient(creds, { fetch: f }).request('GET', '/accounts'), (e: unknown) => e instanceof SaltEdgeError && e.status === 401 && e.errorClass === 'ApiKeyNotFound' && e.message === 'Wrong keys.' && e.requestId === 'rq1');
  const html: typeof fetch = async () => new Response('<html>Bad gateway</html>', { status: 502 });
  await assert.rejects(createSaltEdgeClient(creds, { fetch: html }).request('GET', '/x'), (e: unknown) => e instanceof SaltEdgeError && e.status === 502 && /HTTP 502/.test(e.message));
});

test('a customer is created once; when it already exists it is found by its identifier', async () => {
  const ok = fake({ 'POST /customers': (c) => ({ json: { data: { customer_id: '777', identifier: (c.body as { data: { identifier: string } }).data.identifier } } }) });
  assert.equal(await ensureCustomer(createSaltEdgeClient(creds, { fetch: ok.f }), 'borga-abc'), '777');
  assert.deepEqual(ok.calls[0].body, { data: { identifier: 'borga-abc' } });

  const dup = fake({
    'POST /customers': () => ({ status: 409, json: { error: { class: 'DuplicatedCustomer', message: 'Customer exists.' } } }),
    'GET /customers': () => ({ json: { data: [{ id: '1', identifier: 'someone-else' }, { id: '888', identifier: 'borga-abc' }], meta: { next_id: null } } }),
  });
  assert.equal(await ensureCustomer(createSaltEdgeClient(creds, { fetch: dup.f }), 'borga-abc'), '888');
  const other = fake({ 'POST /customers': () => ({ status: 500, json: { error: { class: 'ServerError', message: 'boom' } } }) });
  await assert.rejects(ensureCustomer(createSaltEdgeClient(creds, { fetch: other.f }), 'x'), /boom/, 'other errors are not swallowed');
});

test('the connect session asks only for accounts and transactions, from a date, and returns to us', async () => {
  const { f, calls } = fake({ 'POST /connections/connect': () => ({ json: { data: { connect_url: 'https://www.saltedge.com/connect?token=t', expires_at: '2026-10-01T10:00:00Z' } } }) });
  const r = await createConnectSession(createSaltEdgeClient(creds, { fetch: f }), {
    customerId: '777', returnTo: 'https://app.example.com/app?saltedge=return', fromDate: '2026-07-01', countryCode: 'DK', providerCode: 'danske_dk', customFields: { workspace: 'ws-1' }, includeFakeProviders: true,
  });
  assert.equal(r.connectUrl, 'https://www.saltedge.com/connect?token=t');
  const d = (calls[0].body as { data: Record<string, any> }).data;
  assert.equal(d.customer_id, '777');
  assert.deepEqual(d.consent, { scopes: ['accounts', 'transactions'], from_date: '2026-07-01' });
  assert.deepEqual(d.attempt.fetch_scopes, ['accounts', 'transactions']);
  assert.equal(d.attempt.return_to, 'https://app.example.com/app?saltedge=return');
  assert.equal(d.attempt.store_credentials, true);
  assert.deepEqual(d.attempt.custom_fields, { workspace: 'ws-1' });
  assert.deepEqual(d.provider, { code: 'danske_dk' });
  assert.equal(d.country_code, 'DK');
  assert.equal(d.include_fake_providers, true);
  const none = fake({ 'POST /connections/connect': () => ({ json: { data: {} } }) });
  await assert.rejects(createConnectSession(createSaltEdgeClient(creds, { fetch: none.f }), { customerId: '1', returnTo: 'https://x', fromDate: '2026-01-01' }), /connect URL/);
});

test('lists are read page by page with from_id until there is no next page', async () => {
  let page = 0;
  const { f, calls } = fake({
    'GET /transactions': (c) => {
      page++;
      const from = c.url.searchParams.get('from_id');
      if (!from) return { json: { data: [{ id: 't1' }, { id: 't2' }], meta: { next_id: 't3' } } };
      if (from === 't3') return { json: { data: [{ id: 't3' }], meta: { next_id: null } } };
      return { json: { data: [] } };
    },
  });
  const all = await listTransactions(createSaltEdgeClient(creds, { fetch: f }), 'c1', 'a1', '2026-01-01');
  assert.deepEqual(all.map((t) => t.id), ['t1', 't2', 't3']);
  assert.equal(page, 2);
  assert.equal(calls[0].url.searchParams.get('connection_id'), 'c1');
  assert.equal(calls[0].url.searchParams.get('account_id'), 'a1');
  assert.equal(calls[0].url.searchParams.get('from_date'), '2026-01-01');
  // a server that keeps returning the same next_id cannot loop us
  const stuck = fake({ 'GET /connections': () => ({ json: { data: [{ id: 'k' }], meta: { next_id: 'k' } } }) });
  const conns = await listConnections(createSaltEdgeClient(creds, { fetch: stuck.f }), 'cust');
  assert.ok(conns.length <= 2, 'stops when next_id does not move');
});

test('accounts map to Borga\'s kinds, last four digits and currency', () => {
  const a = mapAccount({ id: '5', name: ' Business Current ', nature: 'account', balance: 1234.5, currency_code: 'dkk', extra: { iban: 'DK50 0040 0440 1162 43' } }, 'Danske Bank', 'USD');
  assert.deepEqual(a, { externalId: '5', name: 'Business Current', institution: 'Danske Bank', currency: 'DKK', last4: '6243', kind: 'checking', balance: 1234.5 });
  assert.equal(mapAccount({ id: '6', nature: 'savings' }, 'B', 'GHS').kind, 'savings');
  assert.equal(mapAccount({ id: '7', nature: 'credit_card', extra: { account_number: '4111111111111111' } }, 'B', 'GHS').kind, 'credit-card');
  assert.equal(mapAccount({ id: '8', nature: 'loan' }, 'B', 'GHS').currency, 'GHS', 'falls back to the company currency');
  assert.equal(mapAccount({ id: '9' }, 'B', 'GHS').last4, '0000');
  assert.equal(mapAccount({ id: '9' }, 'B', 'GHS').name, 'Bank account');
});

test('transactions: pending and duplicated lines and unusable ones are left out, the rest are cleaned up', () => {
  const base: SeTransaction = { id: 't', account_id: 'a', made_on: '2026-09-15', amount: -50, description: ' Rent   Sept ', status: 'posted' };
  assert.deepEqual(mapTransaction(base).txn, { externalId: 't', accountExternalId: 'a', dateIso: '2026-09-15', description: 'Rent Sept', amount: -50 });
  assert.equal(mapTransaction({ ...base, status: 'pending' }).skip, 'pending');
  assert.equal(mapTransaction({ ...base, duplicated: true }).skip, 'duplicated');
  assert.equal(mapTransaction({ ...base, amount: 0 }).skip, 'invalid');
  assert.equal(mapTransaction({ ...base, made_on: '15/09/2026' }).skip, 'invalid');
  assert.equal(mapTransaction({ ...base, id: '' }).skip, 'invalid');
  assert.equal(mapTransaction({ ...base, amount: Number.NaN }).skip, 'invalid');
  assert.equal(mapTransaction({ ...base, made_on: undefined, extra: { posting_date: '2026-09-16' } }).txn?.dateIso, '2026-09-16', 'falls back to the posting date');
  assert.equal(mapTransaction({ ...base, description: '', extra: { payee: 'Netto A/S' } }).txn?.description, 'Netto A/S');
  assert.equal(mapTransaction({ ...base, description: '', category: 'bank_fees' }).txn?.description, 'bank fees');
  assert.equal(mapTransaction({ ...base, description: '' }).txn?.description, 'Bank transaction');
  assert.equal(mapTransaction({ ...base, description: 'x'.repeat(500) }).txn?.description.length, 200);
});

test('a feed has every account\'s transactions once, oldest first, and says what it left out', async () => {
  const { f } = fake({
    'GET /accounts': () => ({ json: { data: [{ id: 'a1', name: 'Current', nature: 'account', balance: 100, currency_code: 'GHS', extra: { account_number: '0012345678' } }, { id: 'a2', name: 'Savings', nature: 'savings', balance: 5, currency_code: 'GHS' }] } }),
    'GET /transactions': (c) => (c.url.searchParams.get('account_id') === 'a1'
      ? { json: { data: [
        { id: 'x2', made_on: '2026-09-20', amount: -10, description: 'Fuel', status: 'posted' }, { id: 'x1', made_on: '2026-09-01', amount: 500, description: 'Invoice 7', status: 'posted' },
        { id: 'p1', made_on: '2026-09-21', amount: -3, description: 'Coffee', status: 'pending' }, { id: 'd1', made_on: '2026-09-02', amount: -1, description: 'Dup', duplicated: true },
        { id: 'x2', made_on: '2026-09-20', amount: -10, description: 'Fuel', status: 'posted' }, { id: 'bad', made_on: 'Sept', amount: -1 },
      ] } }
      : { json: { data: [{ id: 'y1', made_on: '2026-09-10', amount: 5, description: 'Interest', status: 'posted' }] } }),
  });
  const feed = await fetchFeed(createSaltEdgeClient(creds, { fetch: f }), { id: 'conn1', provider_name: 'GCB Bank' }, 'GHS', '2026-08-01');
  assert.equal(feed.institution, 'GCB Bank');
  assert.deepEqual(feed.accounts.map((a) => [a.externalId, a.last4, a.kind]), [['a1', '5678', 'checking'], ['a2', '0000', 'savings']]);
  assert.deepEqual(feed.transactions.map((t) => [t.externalId, t.accountExternalId, t.amount]), [['x1', 'a1', 500], ['y1', 'a2', 5], ['x2', 'a1', -10]]);
  assert.deepEqual(feed.skipped, { pending: 1, duplicated: 1, invalid: 1 });
});

test('refresh reports a refusal instead of throwing, and removing an already-removed connection is fine', async () => {
  const refused = fake({ 'POST /connections/c1/refresh': () => ({ status: 429, json: { error: { class: 'RefreshTooSoon', message: 'Try later.' } } }) });
  assert.deepEqual(await refreshConnection(createSaltEdgeClient(creds, { fetch: refused.f }), 'c1'), { ok: false, message: 'Try later.' });
  const fine = fake({ 'POST /connections/c1/refresh': () => ({ json: { data: { id: 'c1' } } }) });
  assert.deepEqual(await refreshConnection(createSaltEdgeClient(creds, { fetch: fine.f }), 'c1'), { ok: true });
  assert.deepEqual((fine.calls[0].body as { data: { attempt: { fetch_scopes: string[] } } }).data.attempt.fetch_scopes, ['accounts', 'transactions']);
  const gone = fake({ 'DELETE /connections/c1': () => ({ status: 404, json: { error: { class: 'ConnectionNotFound', message: 'No' } } }) });
  await removeConnection(createSaltEdgeClient(creds, { fetch: gone.f }), 'c1');
  const boom = fake({ 'DELETE /connections/c1': () => ({ status: 500, json: { error: { class: 'ServerError', message: 'boom' } } }) });
  await assert.rejects(removeConnection(createSaltEdgeClient(creds, { fetch: boom.f }), 'c1'), /boom/);
  const odd = fake({ 'DELETE /connections/a%2Fb': () => ({ json: { data: {} } }) });
  await removeConnection(createSaltEdgeClient(creds, { fetch: odd.f }), 'a/b');
  assert.equal(odd.calls.length, 1, 'ids are escaped in the path');
});

test('only https (or localhost) is accepted as the return address', () => {
  assert.equal(validReturnUrl('https://app.example.com/app?saltedge=return'), true);
  assert.equal(validReturnUrl('http://localhost:13000/app'), true);
  assert.equal(validReturnUrl('http://app.example.com/app'), false);
  assert.equal(validReturnUrl('javascript:alert(1)'), false);
  assert.equal(validReturnUrl('not a url'), false);
});

// ── merging a feed into the company's books ───────────────────────────────────────────────────────────────────────────

import { mergeBankFeed, markFeedDisconnected } from './borga/bank-feed';
import type { BankFeed } from './borga/saltedge';
import type { BankAccount, BankTxn } from './borga/data';

const feed = (over: Partial<BankFeed> = {}): BankFeed => ({
  connectionId: 'c1', institution: 'GCB Bank',
  accounts: [{ externalId: 'a1', name: 'Current', institution: 'GCB Bank', currency: 'GHS', last4: '5678', kind: 'checking', balance: 900 }],
  transactions: [
    { externalId: 't1', accountExternalId: 'a1', dateIso: '2026-09-01', description: 'Invoice 7', amount: 500 },
    { externalId: 't2', accountExternalId: 'a1', dateIso: '2026-09-20', description: 'Fuel', amount: -10 },
  ],
  skipped: { pending: 0, duplicated: 0, invalid: 0 }, ...over,
});
const manual: BankAccount = { id: 'bank-1', name: 'Cash', institution: 'Manual', currency: 'GHS', last4: '0000', kind: 'cash', balance: 0, source: 'manual', status: 'disconnected' };

test('a first import adds the accounts and every line, unmatched, newest first', () => {
  const r = mergeBankFeed([manual], [], feed());
  assert.deepEqual(r.stats, { accountsAdded: 1, accountsUpdated: 0, txnsAdded: 2, txnsKnown: 0, txnsOrphaned: 0 });
  assert.equal(r.accounts.length, 2, 'the manual account is untouched');
  const acct = r.accounts.find((a) => a.source === 'saltedge')!;
  assert.deepEqual([acct.id, acct.status, acct.externalId, acct.feedConnectionId, acct.balance], ['bank-se-a1', 'connected', 'a1', 'c1', 900]);
  assert.deepEqual(r.txns.map((t) => [t.id, t.dateIso, t.amount, t.status, t.bankAccountId]), [['bt-se-t2', '2026-09-20', -10, 'unmatched', 'bank-se-a1'], ['bt-se-t1', '2026-09-01', 500, 'unmatched', 'bank-se-a1']]);
});

test('importing the same feed again changes nothing but the balance', () => {
  const first = mergeBankFeed([], [], feed());
  const again = mergeBankFeed(first.accounts, first.txns, feed({ accounts: [{ ...feed().accounts[0], balance: 950 }] }));
  assert.deepEqual(again.stats, { accountsAdded: 0, accountsUpdated: 1, txnsAdded: 0, txnsKnown: 2, txnsOrphaned: 0 });
  assert.equal(again.txns.length, 2);
  assert.equal(again.accounts[0].balance, 950);
  assert.equal(again.accounts.length, 1);
});

test('lines the company has already reconciled, excluded or edited are never touched; only new lines are added', () => {
  const first = mergeBankFeed([], [], feed());
  const worked: BankTxn[] = first.txns.map((t) => (t.externalId === 't1' ? { ...t, status: 'matched', matchedRef: 'INV-7', accountId: 'gl-1100', description: 'Acme payment' } : t.externalId === 't2' ? { ...t, status: 'excluded' } : t));
  const later = feed({ transactions: [...feed().transactions, { externalId: 't3', accountExternalId: 'a1', dateIso: '2026-09-25', description: 'New', amount: -5 }] });
  const r = mergeBankFeed(first.accounts, worked, later);
  assert.equal(r.stats.txnsAdded, 1);
  assert.equal(r.txns.find((t) => t.externalId === 't1')!.status, 'matched');
  assert.equal(r.txns.find((t) => t.externalId === 't1')!.description, 'Acme payment', 'a description the company edited stays');
  assert.equal(r.txns.find((t) => t.externalId === 't2')!.status, 'excluded');
  assert.equal(r.txns[0].externalId, 't3', 'the new line is on top');
});

test('a renamed account keeps its name, a line for an unknown account is counted and left out, a manual line is not mistaken for a bank line', () => {
  const first = mergeBankFeed([], [], feed());
  const renamed = first.accounts.map((a) => ({ ...a, name: 'Operating account' }));
  const r = mergeBankFeed(renamed, first.txns, feed({ transactions: [{ externalId: 'zz', accountExternalId: 'nope', dateIso: '2026-09-01', description: 'x', amount: 1 }] }));
  assert.equal(r.accounts[0].name, 'Operating account');
  assert.equal(r.stats.txnsOrphaned, 1);
  assert.equal(r.txns.some((t) => t.externalId === 'zz'), false);
  const csvLine: BankTxn = { id: 'bt-1', bankAccountId: 'bank-1', date: '2026-09-01', description: 'csv', amount: 500, status: 'unmatched' };
  assert.equal(mergeBankFeed([manual], [csvLine], feed()).stats.txnsAdded, 2, 'a CSV line with the same amount is not a duplicate: only the bank\'s own ids count');
});

test('disconnecting marks only that connection\'s accounts disconnected and keeps their history', () => {
  const a = mergeBankFeed([manual], [], feed());
  const b = mergeBankFeed(a.accounts, a.txns, { ...feed({ connectionId: 'c2' }), accounts: [{ ...feed().accounts[0], externalId: 'a9', name: 'Other bank' }], transactions: [] });
  const out = markFeedDisconnected(b.accounts, 'c1');
  assert.equal(out.find((x) => x.externalId === 'a1')!.status, 'disconnected');
  assert.equal(out.find((x) => x.externalId === 'a9')!.status, 'connected');
  assert.equal(out.find((x) => x.id === 'bank-1')!.status, 'disconnected', 'the manual account was already so and is unchanged');
});
