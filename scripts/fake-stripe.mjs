// A stand-in for the few Stripe endpoints Borga's billing uses, for trying the $2-per-user subscription without a Stripe account:
//
//   node scripts/fake-stripe.mjs                       (listens on http://localhost:14600)
//   .env (development only):
//     BILLING_MODE=enforce
//     STRIPE_SECRET_KEY=sk_test_fakefakefakefake   STRIPE_WEBHOOK_SECRET=whsec_fakefakefakefakefake
//     STRIPE_BASE_URL=http://localhost:14600/v1
//
// Checkout opens a "pay" page here; pressing Pay marks the session paid and creates an active subscription (what Stripe does), then
// sends the user to success_url. POST /__event?type=... lets a script change a subscription's status (past_due, canceled).
// It is not Stripe: it checks nothing about cards.

import http from 'node:http';

const PORT = Number(process.env.PORT ?? 14600);
const KEY = process.env.FAKE_STRIPE_KEY ?? 'sk_test_fakefakefakefake';
let n = 1000;
const customers = new Map();
const sessions = new Map();
const subs = new Map();

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const err = (res, status, message) => json(res, status, { error: { type: 'invalid_request_error', message } });

/** Parses Stripe's a[b][0][c]=v encoding back into an object. */
function parseForm(text) {
  const out = {};
  for (const [k, v] of new URLSearchParams(text)) {
    const path = k.replace(/\]/g, '').split('[');
    let cur = out;
    path.forEach((p, i) => {
      if (i === path.length - 1) cur[p] = v;
      else cur = cur[p] ??= /^\d+$/.test(path[i + 1]) ? [] : {};
    });
  }
  return out;
}
const sub = (id) => {
  const s = subs.get(id);
  return s && { id, status: s.status, customer: s.customer, metadata: s.metadata, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, items: { data: [{ id: s.itemId, quantity: s.quantity }] } };
};

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const path = url.pathname;
    let m;
    if ((m = path.match(/^\/pay\/(cs_\w+)$/))) {
      const s = sessions.get(m[1]);
      if (!s) { res.writeHead(404); return res.end('no such session'); }
      if (url.searchParams.get('confirm') === '1') {
        const id = `sub_${++n}`;
        subs.set(id, { status: 'active', customer: s.customer, metadata: s.subscription_data?.metadata ?? s.metadata, itemId: `si_${++n}`, quantity: Number(s.line_items[0].quantity) });
        s.status = 'complete'; s.payment_status = 'paid'; s.subscription = id;
        res.writeHead(302, { location: s.success_url });
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      const q = Number(s.line_items[0].quantity);
      return res.end(`<!doctype html><title>Fake Stripe Checkout</title><body style="font:16px system-ui;max-width:420px;margin:15vh auto;text-align:center"><h2>Fake Stripe Checkout</h2><p>${s.line_items[0].price_data.product_data.description}</p><p><strong>$${(q * Number(s.line_items[0].price_data.unit_amount) / 100).toFixed(2)} / month</strong></p><a href="/pay/${m[1]}?confirm=1" style="display:inline-block;padding:10px 18px;background:#635bff;color:#fff;border-radius:8px;text-decoration:none">Pay (pretend)</a> <a href="${s.cancel_url}" style="margin-left:12px">Cancel</a></body>`);
    }
    if (path === '/__set' && req.method === 'POST') { // /__set?sub=sub_1&status=past_due
      const s = subs.get(url.searchParams.get('sub')); if (!s) return err(res, 404, 'no sub');
      s.status = url.searchParams.get('status'); return json(res, 200, sub(url.searchParams.get('sub')));
    }
    if (!path.startsWith('/v1/')) return err(res, 404, 'not found');
    if (req.headers.authorization !== `Bearer ${KEY}`) return err(res, 401, 'Invalid API Key provided.');
    const p = path.slice(3);
    const body = raw ? parseForm(raw) : {};
    if (p === '/customers' && req.method === 'POST') { const id = `cus_${++n}`; customers.set(id, body); return json(res, 200, { id }); }
    if (p === '/checkout/sessions' && req.method === 'POST') {
      if (body.mode !== 'subscription' || !body.line_items?.[0]?.price_data?.unit_amount) return err(res, 400, 'bad checkout request');
      const id = `cs_${++n}`; sessions.set(id, { ...body, id, status: 'open', payment_status: 'unpaid' });
      return json(res, 200, { id, url: `http://localhost:${PORT}/pay/${id}` });
    }
    if ((m = p.match(/^\/checkout\/sessions\/(cs_\w+)$/)) && req.method === 'GET') {
      const s = sessions.get(m[1]); if (!s) return err(res, 404, 'No such session');
      return json(res, 200, { id: s.id, status: s.status, payment_status: s.payment_status, metadata: s.metadata, customer: s.customer, subscription: s.subscription ? sub(s.subscription) : null });
    }
    if ((m = p.match(/^\/subscriptions\/(sub_\w+)$/)) && req.method === 'GET') return subs.has(m[1]) ? json(res, 200, sub(m[1])) : err(res, 404, 'No such subscription');
    if ((m = p.match(/^\/subscription_items\/(si_\w+)$/)) && req.method === 'POST') {
      for (const s of subs.values()) if (s.itemId === m[1]) { s.quantity = Number(body.quantity); return json(res, 200, { id: m[1], quantity: s.quantity }); }
      return err(res, 404, 'No such item');
    }
    if (p === '/billing_portal/sessions' && req.method === 'POST') return json(res, 200, { url: `http://localhost:${PORT}/portal` });
    return err(res, 404, `no route ${req.method} ${p}`);
  });
}).listen(PORT, () => console.log(`Fake Stripe on http://localhost:${PORT}/v1 (key "${KEY}")`));
