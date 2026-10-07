import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionToken, parseSessionClaims, verifySessionToken } from './auth/session';

test('a fresh token verifies and carries its user', async () => {
  const token = await createSessionToken('user-1');
  assert.equal(await verifySessionToken(token), 'user-1');
  const claims = parseSessionClaims(token);
  assert.equal(claims?.userId, 'user-1');
});

test('forged and tampered tokens are rejected', async () => {
  const token = await createSessionToken('user-1');
  const [uid, exp, sig] = token.split('.');
  assert.equal(await verifySessionToken(`${uid}.${exp}.deadbeef`), null, 'resigned with garbage');
  assert.equal(await verifySessionToken(`user-2.${exp}.${sig}`), null, 'user id swapped');
  assert.equal(await verifySessionToken(token.slice(0, -2)), null, 'truncated signature');
  assert.equal(await verifySessionToken('not.a.token.at.all'), null);
  assert.equal(await verifySessionToken(null), null);
});

test('expired tokens are rejected without reaching the signature check', async () => {
  const past = Date.now() - 1000;
  assert.equal(await verifySessionToken(`user-1.${past}.whatever`), null);
  assert.equal(parseSessionClaims(`user-1.${past}.whatever`), null);
});
