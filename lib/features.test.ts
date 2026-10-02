import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES, FEATURE_GROUPS, EXPERIMENTAL_ON_BY_DEFAULT, featureForTab, parseEnvOff, resolveFeatures } from './borga/features';

test('defaults follow the registry', () => {
  const { flags } = resolveFeatures(null);
  for (const f of FEATURES) assert.equal(flags[f.id], f.defaultOn);
});

test('simulated and experimental features ship switched off (T30)', () => {
  for (const f of FEATURES) {
    if (f.status === 'simulated') assert.equal(f.defaultOn, false, `${f.id} is simulated and must default off`);
    if (f.status === 'experimental' && !EXPERIMENTAL_ON_BY_DEFAULT.includes(f.id)) assert.equal(f.defaultOn, false, `${f.id} is experimental and must default off`);
  }
  const { flags } = resolveFeatures(null);
  for (const id of ['calls', 'social', 'advertising', 'valuation', 'fundraising', 'whatsapp'] as const) assert.equal(flags[id], false, id);
  // stable and beta features the launch depends on stay on
  for (const id of ['tickets', 'banking', 'emailUpdates', 'agents', 'projects'] as const) assert.equal(flags[id], true, id);
  // an explicit choice still turns an experimental feature on
  assert.equal(resolveFeatures({ calls: true }).flags.calls, true);
});

test('stored overrides win over defaults, env kill list wins over overrides', () => {
  const r = resolveFeatures({ voice: false, calls: true }, parseEnvOff('calls, nonsense'));
  assert.equal(r.flags.voice, false);
  assert.equal(r.flags.calls, false);
  assert.deepEqual(r.locked, ['calls']);
});

test('nav lookup maps pages and tabs to features', () => {
  assert.equal(featureForTab('support'), 'tickets');
  assert.equal(featureForTab('communications', 'calls'), 'calls');
  assert.equal(featureForTab('communications'), null);
  assert.equal(featureForTab('overview'), null);
});

test('every feature has a known group, a unique id, and newer modules are switchable', () => {
  const ids = FEATURES.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const f of FEATURES) assert.ok(FEATURE_GROUPS.includes(f.group), `${f.id} group`);
  assert.equal(featureForTab('finance', 'assets'), 'fixedAssets');
  assert.equal(featureForTab('finance', 'filing'), 'filings');
  assert.equal(featureForTab('company', 'engine'), 'companyEngine');
  const { flags } = resolveFeatures({ fixedAssets: false, filings: false, companyEngine: false, bankFeeds: false });
  assert.deepEqual([flags.fixedAssets, flags.filings, flags.companyEngine, flags.bankFeeds], [false, false, false, false]);
  assert.equal(resolveFeatures(null).flags.bankFeeds, true);
});
