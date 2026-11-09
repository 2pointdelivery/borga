import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionToken, parseSessionClaims, verifySessionToken, type SessionChecks } from './auth/session';

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

/** The database checks only run when a database is configured; set one for these tests and restore it. */
async function withDatabaseUrl<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'mysql://test:test@127.0.0.1:3306/test';
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
}

const liveChecks: SessionChecks = { userGone: async () => false, revoked: async () => false };

test('a session for a deleted user is refused on the next check', async () => {
  const token = await createSessionToken('user-deleted');
  await withDatabaseUrl(async () => {
    assert.equal(await verifySessionToken(token, { userGone: async () => true, revoked: async () => false }), null);
    // The deletion result is what denies it: the same token still verifies while the user exists.
    assert.equal(await verifySessionToken(token, liveChecks), 'user-deleted');
  });
});

test('the deleted-user check runs against the token owner before revocation', async () => {
  const token = await createSessionToken('user-deleted');
  const seen: string[] = [];
  let revocationAsked = false;
  await withDatabaseUrl(async () => {
    assert.equal(
      await verifySessionToken(token, {
        userGone: async (id) => {
          seen.push(id);
          return true;
        },
        revoked: async () => {
          revocationAsked = true;
          return false;
        },
      }),
      null,
    );
  });
  assert.deepEqual(seen, ['user-deleted'], 'the guard checks the token user, not a caller-supplied id');
  assert.equal(revocationAsked, false, 'a deleted user is refused without consulting revocation storage');
});

test('a database error while resolving the session fails open', async () => {
  const token = await createSessionToken('user-1');
  await withDatabaseUrl(async () => {
    assert.equal(
      await verifySessionToken(token, {
        userGone: async () => {
          throw new Error('database is down');
        },
        revoked: async () => false,
      }),
      'user-1',
      'an outage must not sign every user out',
    );
  });
});

test('a signed-out token is still refused through the revocation check', async () => {
  const token = await createSessionToken('user-1');
  await withDatabaseUrl(async () => {
    assert.equal(await verifySessionToken(token, { userGone: async () => false, revoked: async () => true }), null);
  });
});
