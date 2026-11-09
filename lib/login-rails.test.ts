import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOGIN_RAILS,
  evaluateLoginRailGuard,
  normalizeLoginRail,
  resolveRailRedirect,
} from './auth/login-rails';

test('normalizeLoginRail resolves explicit roles and infers rail from ?next= paths', () => {
  assert.equal(LOGIN_RAILS.length, 3);
  assert.equal(normalizeLoginRail('admin'), 'admin');
  assert.equal(normalizeLoginRail('advisor'), 'advisor');
  assert.equal(normalizeLoginRail('company'), 'company');
  assert.equal(normalizeLoginRail(undefined, '/admin'), 'admin');
  assert.equal(normalizeLoginRail(undefined, '/admin/settings'), 'admin');
  assert.equal(normalizeLoginRail(undefined, '/services?tab=bookings'), 'advisor');
  assert.equal(normalizeLoginRail(undefined, '/app'), 'company');
  assert.equal(normalizeLoginRail('invalid', '/unknown'), 'company');
});

test('resolveRailRedirect enforces rail-scoped destinations and blocks open redirects', () => {
  assert.equal(resolveRailRedirect('company', 'login'), '/app');
  assert.equal(resolveRailRedirect('company', 'signup'), '/app/onboarding?step=profile');
  assert.equal(resolveRailRedirect('advisor', 'login'), '/services');
  assert.equal(resolveRailRedirect('admin', 'login'), '/admin');

  // Safe subpaths within the rail are preserved
  assert.equal(resolveRailRedirect('company', 'login', '/app/onboarding?step=industry'), '/app/onboarding?step=industry');
  assert.equal(resolveRailRedirect('advisor', 'login', '/services?tab=profile'), '/services?tab=profile');
  assert.equal(resolveRailRedirect('admin', 'login', '/admin?tab=pricing'), '/admin?tab=pricing');

  // Open redirects and cross-rail mismatches fall back to the rail default
  assert.equal(resolveRailRedirect('company', 'login', '//evil.example.com'), '/app');
  assert.equal(resolveRailRedirect('company', 'login', 'https://evil.example.com'), '/app');
  assert.equal(resolveRailRedirect('admin', 'login', '/app'), '/admin');
  assert.equal(resolveRailRedirect('advisor', 'login', '/admin'), '/services');
});

test('a request body claiming operator or isPro cannot open the admin rail', () => {
  // The rail only chooses a destination; operator status is computed from the
  // configured email list/server-side session, never from the payload.
  const body = { role: 'admin', isOperator: true, isPro: true };
  const guard = evaluateLoginRailGuard({
    rail: normalizeLoginRail(body.role),
    isOperator: false,
    advisorStatus: null,
  });
  assert.equal(guard.allowed, false);
  if (!guard.allowed) assert.equal(guard.status, 403);
});

test('evaluateLoginRailGuard blocks non-operators from admin rail and suspended/rejected advisors from advisor rail', () => {
  assert.deepEqual(evaluateLoginRailGuard({ rail: 'company', isOperator: false }), { allowed: true });
  assert.deepEqual(evaluateLoginRailGuard({ rail: 'admin', isOperator: true }), { allowed: true });

  const nonAdmin = evaluateLoginRailGuard({ rail: 'admin', isOperator: false });
  assert.equal(nonAdmin.allowed, false);
  if (!nonAdmin.allowed) {
    assert.equal(nonAdmin.status, 403);
    assert.ok(nonAdmin.error.includes('System Administrator'));
  }

  assert.deepEqual(evaluateLoginRailGuard({ rail: 'advisor', isOperator: false, advisorStatus: null }), { allowed: true });
  assert.deepEqual(evaluateLoginRailGuard({ rail: 'advisor', isOperator: false, advisorStatus: 'pending' }), { allowed: true });
  assert.deepEqual(evaluateLoginRailGuard({ rail: 'advisor', isOperator: false, advisorStatus: 'approved' }), { allowed: true });

  const suspended = evaluateLoginRailGuard({ rail: 'advisor', isOperator: false, advisorStatus: 'suspended' });
  assert.equal(suspended.allowed, false);
  if (!suspended.allowed) assert.equal(suspended.status, 403);

  const rejected = evaluateLoginRailGuard({ rail: 'advisor', isOperator: false, advisorStatus: 'rejected' });
  assert.equal(rejected.allowed, false);
  if (!rejected.allowed) assert.equal(rejected.status, 403);
});
