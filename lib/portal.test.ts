import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultPortalExpiry,
  isPortalAcceptable,
  isPortalTokenFormat,
  isPortalTokenLive,
  isPortalVisibleQuote,
  type PortalToken,
} from './borga/portal-core';

const token = (over: Partial<PortalToken> = {}): PortalToken => ({
  id: 'pt-1', customerId: 'c-1', customerName: 'Acme', hash: 'h', prefix: 'bpt_…',
  createdAt: '2026-10-01T00:00:00.000Z', expiresAt: null, revokedAt: null, lastUsedAt: null, ...over,
});

test('tokens live until revoked or expired', () => {
  assert.equal(isPortalTokenLive(token(), '2026-10-15T00:00:00.000Z'), true);
  assert.equal(isPortalTokenLive(token({ revokedAt: '2026-10-02T00:00:00.000Z' })), false);
  assert.equal(isPortalTokenLive(token({ expiresAt: '2026-10-10' }), '2026-10-15T00:00:00.000Z'), false);
  assert.equal(isPortalTokenLive(token({ expiresAt: '2026-10-20' }), '2026-10-15T00:00:00.000Z'), true);
});

test('token shape rejects paths and short secrets before any hash work', () => {
  const good = `bpt_${'a'.repeat(32)}`;
  assert.equal(isPortalTokenFormat(good), true);
  assert.equal(isPortalTokenFormat('bpt_short'), false);
  assert.equal(isPortalTokenFormat('../etc/passwd'), false);
  assert.equal(isPortalTokenFormat('borga_somethingelse123456789012345'), false);
  assert.equal(isPortalTokenFormat(null), false);
});

test('customers see non-drafts and accept only sent, in-date quotes', () => {
  assert.equal(isPortalVisibleQuote('draft'), false);
  for (const s of ['sent', 'accepted', 'converted', 'expired']) assert.equal(isPortalVisibleQuote(s), true);
  assert.equal(isPortalAcceptable('sent', '2026-11-01', '2026-10-15'), true);
  assert.equal(isPortalAcceptable('sent', '2026-10-01', '2026-10-15'), false);
  assert.equal(isPortalAcceptable('draft', '2026-11-01', '2026-10-15'), false);
  assert.equal(isPortalAcceptable('converted', '2026-11-01', '2026-10-15'), false);
});

test('default expiry is 90 days out', () => {
  assert.equal(defaultPortalExpiry(new Date('2026-10-15T00:00:00.000Z')), '2027-01-13');
});
