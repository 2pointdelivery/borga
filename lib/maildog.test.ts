import test from 'node:test';
import assert from 'node:assert/strict';
import { MAILDOG_HOST, MAILDOG_URL, describeMailError, maildogConfig } from './borga/maildog';
import { PROVIDERS, getProvider } from './borga/providers';
import { parseSmtp } from './borga/smtp-core';

test('MailDog is set up from the environment: its host, port 587 by default, and the password only from MAILDOG_PASSWORD', () => {
  assert.equal(maildogConfig({}), null);
  assert.equal(maildogConfig({ MAILDOG_USER: 'me@acme.com' }), null, 'a user name alone is not enough');
  assert.equal(maildogConfig({ MAILDOG_PASSWORD: 'x' }), null, 'nor is a password alone');
  const c = maildogConfig({ MAILDOG_USER: 'me@acme.com', MAILDOG_PASSWORD: 'secret' })!;
  assert.deepEqual([c.host, c.port, c.secure, c.user, c.pass, c.from], [MAILDOG_HOST, 587, false, 'me@acme.com', 'secret', 'me@acme.com']);
  assert.equal(MAILDOG_HOST, 'mail.maildog.io');
});

test('port 465 means SSL, other ports fall back to 587, and the From address can be set', () => {
  const ssl = maildogConfig({ MAILDOG_USER: 'me@acme.com', MAILDOG_PASSWORD: 'p', MAILDOG_PORT: '465' })!;
  assert.deepEqual([ssl.port, ssl.secure], [465, true]);
  assert.equal(maildogConfig({ MAILDOG_USER: 'me@acme.com', MAILDOG_PASSWORD: 'p', MAILDOG_PORT: '25' })!.port, 587, 'only the ports MailDog offers');
  assert.equal(maildogConfig({ MAILDOG_USER: 'me@acme.com', MAILDOG_PASSWORD: 'p', MAILDOG_FROM: 'Borga <noreply@acme.com>' })!.from, 'Borga <noreply@acme.com>');
  assert.equal(maildogConfig({ MAILDOG_USER: 'me@acme.com', MAILDOG_PASSWORD: 'p', EMAIL_FROM: 'a@acme.com' })!.from, 'a@acme.com', 'EMAIL_FROM is the fallback');
  assert.equal(maildogConfig({ MAILDOG_USER: 'not-an-address', MAILDOG_PASSWORD: 'p' })!.from, '', 'no invented From address');
});

test('a failed send is explained in plain words and never shows a password', () => {
  assert.match(describeMailError({ code: 'EAUTH', responseCode: 535, response: '535 5.7.8 Authentication failed' }).summary, /user name or password/);
  assert.match(describeMailError({ responseCode: 553, response: '553 sender not allowed' }).summary, /verified sending domain/);
  assert.match(describeMailError({ code: 'ECONNREFUSED' }).summary, /refused the connection/);
  assert.match(describeMailError({ code: 'ETIMEDOUT' }).summary, /Could not connect/);
  assert.match(describeMailError({ message: 'wrong version number' }).summary, /secure connection/);
  const leaked = describeMailError({ code: 'EAUTH', response: 'auth password=hunter2 rejected' });
  assert.ok(!leaked.detail.includes('hunter2'), 'the password is masked');
  assert.match(describeMailError(new Error('boom')).summary, /did not accept/);
  assert.equal(describeMailError(null).summary.length > 0, true);
});

test('the company mail form offers MailDog: a sign-up link and a preset that passes the same checks as typed values', () => {
  const smtp = getProvider('smtp')!;
  assert.equal(smtp.signup?.url, MAILDOG_URL);
  assert.match(smtp.signup!.text, /email address/);
  const preset = smtp.presets!.find((p) => p.id === 'maildog')!;
  assert.deepEqual(preset.values, { host: 'mail.maildog.io', port: '587', secure: 'no' });
  const ok = parseSmtp({ ...preset.values, user: 'me@acme.com', password: 'p', fromAddress: 'noreply@acme.com' });
  assert.equal(ok.ok, true);
  assert.ok(smtp.steps.some((s) => s.includes(MAILDOG_URL)), 'the how-to steps point to MailDog');
  assert.equal(PROVIDERS.filter((p) => p.signup).length, 1, 'only the mail form has a sign-up box');
});
