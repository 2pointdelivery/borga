import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSENT_VERSION,
  applyGpc,
  choiceNeedsRefresh,
  defaultChoices,
  isRegion,
  normalizeChoice,
} from './borga/consent';

test('opt-in regions start all-off; North America starts analytics-on (opt-out)', () => {
  assert.deepEqual(defaultChoices('europe'), { necessary: true, analytics: false, advertising: false, personalization: false, security: true });
  assert.deepEqual(defaultChoices('africa'), { necessary: true, analytics: false, advertising: false, personalization: false, security: true });
  assert.equal(defaultChoices('north-america').analytics, true);
  assert.equal(defaultChoices('north-america').advertising, false);
});

test('stored choices normalize: unknown regions fall back to strictest, necessary forced on', () => {
  const c = normalizeChoice({ region: 'atlantis', choices: { analytics: true, necessary: false } });
  assert.ok(c);
  assert.equal(c.region, 'europe');
  assert.equal(c.choices.necessary, true);
  assert.equal(c.choices.analytics, true);
  assert.equal(isRegion('europe'), true);
  assert.equal(isRegion('xx'), false);
});

test('a policy version bump re-asks', () => {
  assert.equal(choiceNeedsRefresh(null), true);
  const c = normalizeChoice({ region: 'europe', choices: {}, version: CONSENT_VERSION });
  assert.equal(choiceNeedsRefresh(c), false);
  assert.equal(choiceNeedsRefresh({ ...c!, version: CONSENT_VERSION - 1 }), true);
});

test('GPC always opts out of analytics and advertising', () => {
  const na = applyGpc(null, 'north-america');
  assert.equal(na.choices.analytics, false);
  assert.equal(na.choices.advertising, false);
  assert.equal(na.choices.necessary, true);
  assert.equal(na.source, 'gpc');
  const eu = applyGpc(normalizeChoice({ region: 'europe', choices: { analytics: true, advertising: true } })!, 'europe');
  assert.equal(eu.choices.analytics, false);
  assert.equal(eu.source, 'gpc');
});
