import assert from 'node:assert/strict';
import test from 'node:test';
import { autopilotDefersToCron, autopilotOffValue, autopilotSkipReason, parseAutopilotInterval, planSweep } from './borga/autopilot-policy';

test('the cadence defaults to one minute and is clamped to a sane range', () => {
  assert.equal(parseAutopilotInterval(undefined), 60_000);
  assert.equal(parseAutopilotInterval('nonsense'), 60_000);
  assert.equal(parseAutopilotInterval('1000'), 15_000);
  assert.equal(parseAutopilotInterval('99999999'), 3_600_000);
  assert.equal(parseAutopilotInterval('120000'), 120_000);
});

test('the kill switch accepts the documented forms only', () => {
  assert.equal(autopilotOffValue('1'), true);
  assert.equal(autopilotOffValue('true'), true);
  assert.equal(autopilotOffValue('off'), false);
  assert.equal(autopilotOffValue(undefined), false);
});

test('paused and switched-off workspaces are skipped', () => {
  assert.equal(autopilotSkipReason({ heartbeatPaused: true }, true, false), 'paused');
  assert.equal(autopilotSkipReason({ autonomousMode: false, autonomousModeChosen: true }, true, false), 'autonomous mode off');
  assert.equal(autopilotSkipReason(null, false, false), 'feature "heartbeat" is off');
  assert.equal(autopilotSkipReason(null, true, true), 'subscription needed');
});

test('an old "off" default is not a decision: those workspaces still run', () => {
  assert.equal(autopilotSkipReason({ autonomousMode: false }, true, false), null);
  assert.equal(autopilotSkipReason({ heartbeatPaused: true, autonomousMode: true }, true, false), 'paused');
});

test('an eligible workspace has no skip reason', () => {
  assert.equal(autopilotSkipReason({}, true, false), null);
});

test('an operator-configured cron trigger makes the loop stand down', () => {
  assert.equal(autopilotDefersToCron('a-real-secret'), true);
  assert.equal(autopilotDefersToCron('  '), false);
  assert.equal(autopilotDefersToCron(''), false);
  assert.equal(autopilotDefersToCron(undefined), false);
});

test('a capped sweep reports what it left out instead of hiding it', () => {
  assert.deepEqual(planSweep([1, 2], 5), { targets: [1, 2], truncated: 0 });
  assert.deepEqual(planSweep([1, 2, 3, 4], 3), { targets: [1, 2, 3], truncated: 1 });
  assert.deepEqual(planSweep([], 5), { targets: [], truncated: 0 });
});
