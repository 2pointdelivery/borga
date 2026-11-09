import test from 'node:test';
import assert from 'node:assert/strict';
import { signupMode, operatorEmails, isOperator, decideSignup, checkInvite, newInviteCode, hashInviteCode, INVITE_TTL_MS } from './auth/signup-policy';

const PROD = { NODE_ENV: 'production', BORGA_OPERATOR_EMAILS: 'Owner@Acme.com, ops@acme.com' };

test('signup mode defaults to invite in production and open elsewhere; explicit values win', () => {
  assert.equal(signupMode({ NODE_ENV: 'production' }), 'invite');
  assert.equal(signupMode({ NODE_ENV: 'development' }), 'open');
  assert.equal(signupMode({ NODE_ENV: 'production', SIGNUP_MODE: 'OPEN' }), 'open');
  assert.equal(signupMode({ NODE_ENV: 'production', SIGNUP_MODE: 'closed' }), 'closed');
  assert.equal(signupMode({ NODE_ENV: 'production', SIGNUP_MODE: 'bogus' }), 'invite');
});

test('operators are matched case-insensitively; unlisted users are not operators in production', () => {
  assert.deepEqual(operatorEmails(PROD), ['owner@acme.com', 'ops@acme.com']);
  assert.equal(isOperator('OWNER@acme.com', PROD), true);
  assert.equal(isOperator('stranger@x.com', PROD), false);
  assert.equal(isOperator(null, PROD), false);
});

test('with no operators configured: production has none, development treats a signed-in user as operator', () => {
  assert.equal(isOperator('a@b.com', { NODE_ENV: 'production' }), false);
  assert.equal(isOperator('a@b.com', { NODE_ENV: 'development' }), true);
  assert.equal(isOperator(null, { NODE_ENV: 'development' }), false);
});

test('invite mode requires a code; closed mode refuses; operators always get in', () => {
  assert.deepEqual(decideSignup('invite', 'new@x.com', false, PROD), { allow: false, status: 403, error: 'Signup is by invitation. Enter the invite code you were sent.' });
  assert.deepEqual(decideSignup('invite', 'new@x.com', true, PROD), { allow: true, consumeInvite: true });
  assert.equal(decideSignup('closed', 'new@x.com', true, PROD).allow, false);
  assert.deepEqual(decideSignup('closed', 'owner@acme.com', false, PROD), { allow: true, consumeInvite: false });
  assert.deepEqual(decideSignup('invite', 'OWNER@acme.com', false, PROD), { allow: true, consumeInvite: false });
  assert.deepEqual(decideSignup('open', 'anyone@x.com', false, PROD), { allow: true, consumeInvite: false });
});

test('the development default of "everyone is an operator" does not open invite-only or closed signup', () => {
  const dev = { NODE_ENV: 'development' };
  assert.equal(decideSignup('invite', 'x@y.com', false, dev).allow, false);
  assert.equal(decideSignup('closed', 'x@y.com', false, dev).allow, false);
});

test('invite validation: unknown, expired and wrong-email codes are rejected', () => {
  const now = 1_000_000;
  const rec = { email: 'New@X.com', createdBy: 'u1', createdAt: now, expiresAt: now + INVITE_TTL_MS };
  assert.equal(checkInvite(rec, 'new@x.com', now + 10).ok, true);
  assert.equal(checkInvite(null, 'new@x.com', now).ok, false);
  assert.equal(checkInvite(rec, 'new@x.com', now + INVITE_TTL_MS + 1).ok, false);
  assert.equal(checkInvite(rec, 'other@x.com', now).ok, false);
});

test('invite codes are random, prefixed, and hashed deterministically without exposing the code', () => {
  const a = newInviteCode();
  const b = newInviteCode();
  assert.match(a, /^inv_[A-Za-z0-9_-]{20,}$/);
  assert.notEqual(a, b);
  assert.equal(hashInviteCode(a), hashInviteCode(` ${a} `));
  assert.match(hashInviteCode(a), /^[0-9a-f]{64}$/);
  assert.ok(!hashInviteCode(a).includes(a));
});
