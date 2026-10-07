import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSmtp, fromHeader, explainSmtpError, SMTP_PORTS } from './borga/smtp-core';

const ok = { host: 'smtp.gmail.com', port: '587', user: 'me@acme.com', password: 'app-password', fromAddress: 'billing@acme.com', fromName: 'Acme Billing' };

test('good settings are accepted and normalised', () => {
  const r = parseSmtp(ok);
  assert.deepEqual(r, { ok: true, settings: { host: 'smtp.gmail.com', port: 587, secure: false, user: 'me@acme.com', password: 'app-password', fromAddress: 'billing@acme.com', fromName: 'Acme Billing' } });
  const d = parseSmtp({ host: ' SMTP.Acme.COM ', fromAddress: 'a@acme.com' });
  assert.ok(d.ok && d.settings.port === 587 && d.settings.host === 'smtp.acme.com' && d.settings.user === '' && d.settings.secure === false, 'defaults: port 587, no login, host lower-cased');
  assert.ok(parseSmtp({ ...ok, port: '465' }).ok && (parseSmtp({ ...ok, port: '465' }) as { settings: { secure: boolean } }).settings.secure === true, 'port 465 is encrypted by default');
  assert.equal((parseSmtp({ ...ok, secure: 'yes' }) as { settings: { secure: boolean } }).settings.secure, true);
});

test('hosts that could reach inside the network, odd ports, and half-filled forms are refused with a reason', () => {
  const err = (over: Record<string, string>) => { const r = parseSmtp({ ...ok, ...over }); assert.equal(r.ok, false); return (r as { error: string }).error; };
  assert.match(err({ host: '' }), /required/);
  for (const host of ['127.0.0.1', '10.0.0.5', '169.254.169.254', 'localhost', 'http://smtp.acme.com', 'smtp.acme.com:587', 'smtp acme.com', '[::1]', 'intranet']) assert.match(err({ host }), /host name/, host);
  for (const port of ['22', '3306', '6379', '80', '0', '587.5', 'abc', '99999']) assert.match(err({ port }), /port must be one of/, port);
  for (const p of SMTP_PORTS) assert.ok(parseSmtp({ ...ok, port: String(p), secure: p === 465 ? 'true' : '' }).ok, String(p));
  assert.match(err({ port: '465', secure: 'no' }), /465 is always encrypted/);
  assert.match(err({ password: '' }), /needs its password/);
  assert.match(err({ fromAddress: 'not an email' }), /mail should come from/);
  assert.match(err({ fromAddress: '' }), /mail should come from/);
  assert.ok(parseSmtp({ ...ok, user: '', password: '' }).ok, 'a server with no login is allowed (an internal relay that trusts the address)');
});

test('the From header cannot be used to inject headers, and reads as "Name <address>"', () => {
  const r = parseSmtp({ ...ok, fromName: 'Evil\r\nBcc: x@y.z "<a>"' }) as { ok: true; settings: { fromName: string; fromAddress: string } };
  assert.ok(!/[\r\n"<>]/.test(r.settings.fromName));
  assert.equal(fromHeader({ fromAddress: 'a@b.co', fromName: 'Acme' }), 'Acme <a@b.co>');
  assert.equal(fromHeader({ fromAddress: 'a@b.co', fromName: '' }), 'a@b.co');
  assert.equal((parseSmtp({ ...ok, fromName: 'x'.repeat(200) }) as { settings: { fromName: string } }).settings.fromName.length, 80);
});

test('a refusal is explained in words a person can act on', () => {
  assert.match(explainSmtpError({ code: 'EAUTH' }), /app password/);
  assert.match(explainSmtpError({ responseCode: 535 }), /user name or password/);
  assert.match(explainSmtpError({ code: 'ECONNREFUSED' }), /port/);
  assert.match(explainSmtpError({ code: 'ENOTFOUND' }), /does not exist/);
  assert.match(explainSmtpError({ code: 'ETIMEDOUT' }), /Could not connect/);
  assert.match(explainSmtpError({ message: 'wrong version number' }), /secure connection/);
  assert.match(explainSmtpError({ responseCode: 550 }), /sender address/);
  assert.match(explainSmtpError({}), /did not accept/);
});
