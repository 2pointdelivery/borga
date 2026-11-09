import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_CAP_TABLE, convertSafesPostMoney, convertNotes, ownershipPct, waterfall, fullyDiluted } from './borga/cap-table';

test('post-money SAFE fixes ownership %', () => {
  const s = { ...EMPTY_CAP_TABLE, safes: [{ id: 's1', stakeholderId: 'a', amount: 200_000, cap: 10_000_000, kind: 'safe' as const }] };
  const out = convertSafesPostMoney(s, 10_000_000, 2);
  assert.equal(out[0].shares, 200_000 / 1); // cap 10M / companyCap 10M = $1
});

test('note picks lesser of cap vs discount', () => {
  const s = { ...EMPTY_CAP_TABLE, safes: [{ id: 'n1', stakeholderId: 'a', amount: 100_000, cap: 10_000_000, discount: 0.8, kind: 'note' as const }] };
  const out = convertNotes(s, 10_000_000, 1.1738);
  assert.ok(out[0].price < 1.1738);
});

test('ownership + waterfall sum to proceeds', () => {
  const s = {
    ...EMPTY_CAP_TABLE,
    stakeholders: [{ id: 'a', name: 'A', kind: 'founder' as const }, { id: 'b', name: 'B', kind: 'investor' as const }],
    classes: [{ id: 'common', name: 'Common', seniority: 0 }, { id: 'pref', name: 'Pref', seniority: 1 }],
    holdings: [{ stakeholderId: 'a', classId: 'common', shares: 8_000_000 }, { stakeholderId: 'b', classId: 'pref', shares: 2_000_000 }],
  };
  assert.equal(Math.round(ownershipPct(s, 'a')), 80);
  const w = waterfall(s, 1_000_000);
  const sum = w.reduce((t, x) => t + x.amount, 0);
  assert.ok(Math.abs(sum - 1_000_000) < 1);
  assert.ok(fullyDiluted(s) === 10_000_000);
});
