import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreCandidate, rankCandidates, AUTO_MATCH_SCORE } from './borga/reconcile';
import { parseAdCsv, dedupeAdRows } from './borga/ads-import';

const TXN = { amount: -250, dateIso: '2026-10-05', description: 'MTN MOMO Acme Supplies Accra' };

test('same amount, same week, same payee scores near-certain', () => {
  const s = scoreCandidate(TXN, { ref: 'x', amount: -250, dateIso: '2026-10-06', label: 'Payment to Acme Supplies' });
  assert.ok(s.score >= AUTO_MATCH_SCORE, `got ${s.score}: ${s.reasons.join(',')}`);
});

test('same amount a month apart is refused', () => {
  const s = scoreCandidate(TXN, { ref: 'x', amount: -250, dateIso: '2026-08-01', label: 'MTN MOMO Acme Supplies' });
  assert.equal(s.score, 0);
});

test('opposite sign never matches', () => {
  const s = scoreCandidate(TXN, { ref: 'x', amount: 250, dateIso: '2026-10-05', label: 'MTN MOMO Acme Supplies' });
  assert.equal(s.score, 0);
});

test('ranking keeps the best above the bar only', () => {
  const ranked = rankCandidates(TXN, [
    { ref: 'far', amount: -250, dateIso: '2026-01-01', label: 'Acme' },
    { ref: 'near', amount: -251, dateIso: '2026-10-04', label: 'Acme Supplies Accra' },
  ]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].candidate.ref, 'near');
});

test('ad CSV import maps aliases, normalises dates and dedupes', () => {
  const csv = [
    'Campaign Name,Channel,Budget,Spend,Impressions,Clicks,Conversions,Conversion Value,Start Date,End Date',
    '"Spring Sale",LinkedIn Ads,1000,"$812.50",12000,340,12,2400,2026-03-01,2026-03-31',
    'Direct Traffic,google,500,250,0,0,0,0,,,',
  ].join('\n');
  const r = parseAdCsv(csv);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].platform, 'linkedin');
  assert.equal(r.rows[0].spent, 812.5);
  assert.equal(r.rows[0].revenue, 2400);
  assert.equal(r.rows[0].startDate, '2026-03-01');
  // 'campaign' is a valid alias for name → imports fine; a header with no name column is refused
  assert.equal(parseAdCsv('Campaign\nx').rows.length, 1);
  assert.ok(parseAdCsv('a,b\n1,2').skipped.length >= 1);
  // dedupe by (name, platform): existing campaigns are never duplicated
  const d = dedupeAdRows(r.rows, [{ name: 'spring sale', platform: 'linkedin' }]);
  assert.equal(d.toAdd.length, 1);
  assert.equal(d.duplicates.length, 1);
  assert.equal(d.toAdd[0].name, 'Direct Traffic');
});
