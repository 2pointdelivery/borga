// A stand-in for Salt Edge's API v6, for trying the bank feed without a Salt Edge account:
//
//   node scripts/fake-saltedge.mjs            (listens on http://localhost:14500)
//   then, in .env (development only):  SALTEDGE_BASE_URL=http://localhost:14500/api/v6
//   and save any App ID and Secret under Connections; the secret below must match.
//
// It implements just what Borga calls: customers, connect sessions, connections, accounts and transactions (with from_id paging, a
// pending line and a duplicate to be left out), refresh and delete. The "bank" page signs in with one click and sends the user
// back to the return_to address. It is not Salt Edge and checks nothing about real banks.

import http from 'node:http';

const PORT = Number(process.env.PORT ?? 14500);
const SECRET = process.env.FAKE_SALTEDGE_SECRET ?? 'testsecret';
const customers = new Map(); // identifier -> id
const connections = []; // { id, customer_id }
let nextId = 100;

const accounts = (connId) => [
  { id: `${connId}-a1`, connection_id: connId, name: 'Business Current', nature: 'account', balance: 18420.55, currency_code: 'GHS', extra: { account_number: '0123456789' } },
  { id: `${connId}-a2`, connection_id: connId, name: 'Reserve Savings', nature: 'savings', balance: 5000, currency_code: 'GHS', extra: { account_number: '0987654321' } },
];
const today = (back) => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
const txns = (connId, acct) =>
  acct.endsWith('a1')
    ? [
        { id: `${connId}-t1`, account_id: acct, made_on: today(20), amount: 5200, currency_code: 'GHS', description: 'Customer payment INV-1042', status: 'posted' },
        { id: `${connId}-t2`, account_id: acct, made_on: today(18), amount: -1450.75, currency_code: 'GHS', description: 'ECG prepaid electricity', status: 'posted' },
        { id: `${connId}-t3`, account_id: acct, made_on: today(12), amount: -300, currency_code: 'GHS', description: 'MTN mobile money fees', status: 'posted' },
        { id: `${connId}-t4`, account_id: acct, made_on: today(7), amount: -820, currency_code: 'GHS', description: 'Office rent - October', status: 'posted' },
        { id: `${connId}-t5`, account_id: acct, made_on: today(1), amount: -59.9, currency_code: 'GHS', description: 'Pending card payment', status: 'pending' },
        { id: `${connId}-t6`, account_id: acct, made_on: today(7), amount: -820, currency_code: 'GHS', description: 'Office rent - October', status: 'posted', duplicated: true },
      ]
    : [{ id: `${connId}-t7`, account_id: acct, made_on: today(3), amount: 12.4, currency_code: 'GHS', description: 'Interest', status: 'posted' }];

const send = (res, status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
const fail = (res, status, cls, message) => send(res, status, { error: { class: cls, message, request_id: 'fake' } });

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (path === '/connect') { // the "bank": one click and back
    const back = url.searchParams.get('return_to') ?? '/';
    const connId = url.searchParams.get('conn');
    const dest = `${back}${back.includes('?') ? '&' : '?'}connection_id=${encodeURIComponent(connId ?? '')}`;
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><title>Fake Bank</title><body style="font:16px system-ui;max-width:420px;margin:15vh auto;text-align:center"><h2>Fake Bank (Salt Edge test)</h2><p>Signing in is pretend. Press the button to approve sharing your accounts.</p><a href="${dest}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;border-radius:8px;text-decoration:none">Approve and return</a></body>`);
    return;
  }
  if (!path.startsWith('/api/v6')) return fail(res, 404, 'NotFound', 'Not found');
  if (req.headers['app-id'] !== (process.env.FAKE_SALTEDGE_APP_ID ?? req.headers['app-id']) || req.headers.secret !== SECRET) return fail(res, 401, 'ApiKeyNotFound', 'Wrong App-id or Secret.');

  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {};
    const p = path.replace('/api/v6', '');
    if (p === '/customers' && req.method === 'POST') {
      const id = body.data?.identifier;
      if (customers.has(id)) return fail(res, 409, 'DuplicatedCustomer', 'Customer already exists.');
      customers.set(id, String(++nextId));
      return send(res, 200, { data: { customer_id: customers.get(id), identifier: id } });
    }
    if (p === '/customers' && req.method === 'GET') return send(res, 200, { data: [...customers].map(([identifier, id]) => ({ id, identifier })), meta: { next_id: null } });
    if (p === '/connections/connect' && req.method === 'POST') {
      const d = body.data ?? {};
      if (!d.consent?.scopes?.includes('transactions') || !d.attempt?.return_to) return fail(res, 400, 'WrongRequestFormat', 'consent.scopes and attempt.return_to are required.');
      const conn = { id: String(++nextId), customer_id: String(d.customer_id), provider_name: 'Fake Bank', provider_code: 'fakebank_xf', status: 'active' };
      connections.push(conn);
      return send(res, 200, { data: { connect_url: `http://localhost:${PORT}/connect?conn=${conn.id}&return_to=${encodeURIComponent(d.attempt.return_to)}`, expires_at: new Date(Date.now() + 3600_000).toISOString(), customer_id: d.customer_id } });
    }
    if (p === '/connections' && req.method === 'GET') return send(res, 200, { data: connections.filter((c) => c.customer_id === url.searchParams.get('customer_id')), meta: { next_id: null } });
    let m = p.match(/^\/connections\/(\d+)$/);
    if (m && req.method === 'GET') { const c = connections.find((x) => x.id === m[1]); return c ? send(res, 200, { data: c }) : fail(res, 404, 'ConnectionNotFound', 'No such connection.'); }
    if (m && req.method === 'DELETE') { const i = connections.findIndex((x) => x.id === m[1]); if (i < 0) return fail(res, 404, 'ConnectionNotFound', 'No such connection.'); connections.splice(i, 1); return send(res, 200, { data: { removed: true } }); }
    m = p.match(/^\/connections\/(\d+)\/refresh$/);
    if (m && req.method === 'POST') return send(res, 200, { data: { id: m[1], next_refresh_possible_at: new Date(Date.now() + 3600_000).toISOString() } });
    if (p === '/accounts' && req.method === 'GET') return send(res, 200, { data: accounts(url.searchParams.get('connection_id')), meta: { next_id: null } });
    if (p === '/transactions' && req.method === 'GET') {
      const all = txns(url.searchParams.get('connection_id'), url.searchParams.get('account_id'));
      const from = url.searchParams.get('from_id');
      const start = from ? all.findIndex((t) => t.id === from) : 0;
      const page = all.slice(Math.max(0, start), Math.max(0, start) + 3);
      const next = all[Math.max(0, start) + 3];
      return send(res, 200, { data: page, meta: { next_id: next ? next.id : null } });
    }
    return fail(res, 404, 'NotFound', `No route ${req.method} ${p}`);
  });
}).listen(PORT, () => console.log(`Fake Salt Edge on http://localhost:${PORT}/api/v6 (secret "${SECRET}")`));
