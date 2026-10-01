import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES, featureForTab, parseEnvOff, resolveFeatures } from './borga/features';

test('defaults follow the registry', () => {
  const { flags } = resolveFeatures(null);
  for (const f of FEATURES) assert.equal(flags[f.id], f.defaultOn);
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
