import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCOUNT_SIDE_HINT,
  DR_CR_LEGEND,
  NORMAL_SIDE,
  NORMAL_SIDE_SHORT,
  isDebitNormal,
  journalLineHint,
  splitDrCr,
} from './borga/accounting-labels';
import type { AccountType } from './borga/data';

const TYPES: AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'cost', 'expense'];

test('IFRS normal sides: assets, costs and expenses are Dr normal; liabilities, equity and revenue are Cr normal', () => {
  assert.deepEqual(
    Object.fromEntries(TYPES.map((t) => [t, NORMAL_SIDE[t]])),
    { asset: 'Dr', liability: 'Cr', equity: 'Cr', revenue: 'Cr', cost: 'Dr', expense: 'Dr' },
  );
  assert.equal(isDebitNormal('cost'), true);
  assert.equal(isDebitNormal('revenue'), false);
});

test('splitDrCr puts net debits in Dr and net credits in Cr', () => {
  assert.deepEqual(splitDrCr(100), { dr: 100, cr: 0 });
  assert.deepEqual(splitDrCr(-100), { dr: 0, cr: 100 });
  assert.deepEqual(splitDrCr(0), { dr: 0, cr: 0 });
});

test('a balanced set of journals always balances total Dr against total Cr', () => {
  // Dr Cash 1000 / Cr Revenue 1000; Dr COGS 200 / Cr Cash 200.
  const deltas = new Map([['cash', 800], ['rev', -1000], ['cogs', 200]]);
  let dr = 0, cr = 0;
  for (const d of deltas.values()) {
    const s = splitDrCr(d);
    dr += s.dr;
    cr += s.cr;
  }
  assert.equal(dr, cr);
  assert.equal(dr, 1000);
});

test('every account type has a human-readable increase/decrease hint', () => {
  for (const t of TYPES) {
    assert.match(ACCOUNT_SIDE_HINT[t], /increases/, `${t} hint names what increases it`);
    assert.match(ACCOUNT_SIDE_HINT[t], /decreases/, `${t} hint names what decreases it`);
    assert.match(ACCOUNT_SIDE_HINT[t], /Dr|Cr/, `${t} hint names the side`);
    assert.ok(NORMAL_SIDE_SHORT[t].length > 0);
  }
  assert.match(DR_CR_LEGEND, /total Dr = total Cr/);
  assert.match(journalLineHint('Cash', 'asset'), /Dr ↑ increases/);
  assert.match(journalLineHint('Sales', 'revenue'), /Cr ↑ increases/);
});
