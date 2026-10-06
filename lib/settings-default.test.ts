import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, normalizeSettings } from './borga/data';

test('autonomous mode is on by default, for new companies and for ones that only ever had the old default', () => {
  assert.equal(DEFAULT_SETTINGS.autonomousMode, true);
  assert.equal(normalizeSettings(null).autonomousMode, true, 'a company with nothing saved');
  assert.equal(normalizeSettings({ autonomousMode: false }).autonomousMode, true, 'saved "off" that nobody chose is the old default');
  assert.equal(normalizeSettings({ crmUrl: 'https://x.test' }).autonomousMode, true, 'settings saved before the option existed');
});

test('a company that switched it off itself keeps it off, and one that switched it on keeps it on', () => {
  assert.equal(normalizeSettings({ autonomousMode: false, autonomousModeChosen: true }).autonomousMode, false);
  assert.equal(normalizeSettings({ autonomousMode: true, autonomousModeChosen: true }).autonomousMode, true);
});

test('the rest of the saved settings are kept', () => {
  const s = normalizeSettings({ crmUrl: 'https://x.test', llmFallback: false, quietHours: { start: '22:00', end: '07:00' } });
  assert.equal(s.crmUrl, 'https://x.test');
  assert.equal(s.llmFallback, false);
  assert.deepEqual(s.quietHours, { start: '22:00', end: '07:00' });
  assert.deepEqual(s.notifications, DEFAULT_SETTINGS.notifications);
});
