import test from 'node:test';
import assert from 'node:assert/strict';
import { compareLeadsByScore, scoreLead } from './borga/lead-score';
import type { Lead } from './borga/data';

const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const lead = (over: Partial<Lead> = {}): Lead => ({
  id: 'l-1', name: 'Ama Serwaa', company: 'Accra Foods', email: 'ama@accra.test', phone: '+2331',
  value: 12000, stage: 'proposal', source: 'Referral', ownerId: 'a-sales', priority: 'P1',
  createdAt: daysAgo(10), lastContactAt: daysAgo(1),
  diagnosis: { problem: 'Spoilage', since: '6 months', tried: 'Manual logs' },
  ...over,
});

test('a worked, diagnosed, valuable proposal scores hot with named factors', () => {
  const s = scoreLead(lead());
  assert.equal(s.band, 'hot');
  assert.ok(s.score >= 65 && s.score <= 100);
  assert.equal(s.factors.length, 4);
  assert.ok(s.factors.every((f) => f.points <= f.max && f.why.length > 0));
  assert.deepEqual(s.factors.map((f) => f.key), ['value', 'stage', 'recency', 'fit']);
});

test('lost freezes at zero; stale and empty sink to cold', () => {
  assert.equal(scoreLead(lead({ stage: 'lost' })).score, 0);
  const cold = scoreLead(lead({ value: 0, stage: 'new', email: '', phone: '', diagnosis: undefined, lastContactAt: daysAgo(60), createdAt: daysAgo(90) }), NOW);
  assert.equal(cold.band, 'cold');
  assert.ok(cold.score < 35);
});

test('scoring is deterministic and stage-ordered', () => {
  assert.deepEqual(scoreLead(lead()), scoreLead(lead()));
  const byStage = (['new', 'qualified', 'proposal'] as const).map((stage) => scoreLead(lead({ stage }), NOW).score);
  assert.ok(byStage[0] < byStage[1] && byStage[1] < byStage[2], JSON.stringify(byStage));
});

test('pipeline order puts hot first, closed last', () => {
  const hot = lead({ id: 'h' });
  const cold = lead({ id: 'c', value: 50, stage: 'new', lastContactAt: daysAgo(90) });
  const won = lead({ id: 'w', stage: 'won' });
  const lost = lead({ id: 'x', stage: 'lost' });
  const ordered = [lost, cold, won, hot].sort((a, b) => compareLeadsByScore(a, b, NOW)).map((l) => l.id);
  assert.deepEqual(ordered, ['h', 'c', 'w', 'x']);
});
