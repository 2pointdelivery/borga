import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBocValetJson, parseEcbXml, rateFor, convert, revalueDocs, postFxRevaluation, resolveFxAccounts } from './borga/fx';
import { dcfValue } from './borga/dcf';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
<gesmes:subject>Reference rates</gesmes:subject>
<gesmes:Sender><gesmes:name>European Central Bank</gesmes:name></gesmes:Sender>
<Cube><Cube time="2026-10-09"><Cube currency="USD" rate="1.1624"/><Cube currency="GBP" rate="0.8653"/><Cube currency="GHS" rate="14.05"/><Cube currency="CAD" rate="1.6121"/><Cube currency="DKK" rate="7.4593"/></Cube></Cube>
</gesmes:Envelope>`;

test('ECB xml parses to dated rates', () => {
  const r = parseEcbXml(XML);
  assert.equal(r.base, 'EUR');
  assert.equal(r.date, '2026-10-09');
  assert.equal(r.rates.USD, 1.1624);
  assert.throws(() => parseEcbXml('<nope/>'));
});

test('Bank of Canada Valet JSON parses FX_RATES_DAILY observations into CAD-based rates and converts accurately', () => {
  const bocSample = {
    observations: [
      {
        d: '2026-10-16',
        FXUSDCAD: { v: '1.4154' },
        FXEURCAD: { v: '1.5908' },
        FXGBPCAD: { v: '1.8871' },
        FXAUDCAD: { v: '0.9837' },
        FXJPYCAD: { v: '0.008960' },
      },
    ],
  };
  const r = parseBocValetJson(bocSample);
  assert.equal(r.base, 'CAD');
  assert.equal(r.source, 'boc');
  assert.equal(r.date, '2026-10-16');
  assert.equal(r.rates.CAD, 1);
  // 100 USD at 1.4154 CAD per USD = 141.54 CAD
  assert.equal(convert(100, 'USD', 'CAD', r), 141.54);
  // 100 EUR -> USD cross rate via CAD pivot
  const eurToUsd = convert(100, 'EUR', 'USD', r);
  assert.ok(eurToUsd !== null && Math.abs(eurToUsd - (100 * 1.5908) / 1.4154) < 0.02);
  assert.throws(() => parseBocValetJson({ observations: [] }));
});

test('conversion pivots through EUR, identity is exact', () => {
  const r = parseEcbXml(XML);
  assert.equal(rateFor(r, 'USD', 'USD'), 1);
  // 100 USD → EUR → GHS
  const ghs = convert(100, 'USD', 'GHS', r);
  assert.ok(ghs !== null && Math.abs(ghs - (100 / 1.1624) * 14.05) < 0.02);
  assert.equal(convert(10, 'USD', 'XXX', r), null);
});

test('revaluation flags gains and losses, skips same-currency', () => {
  const r = parseEcbXml(XML);
  const lines = revalueDocs([
    { id: 'a', number: 'INV-1', kind: 'invoice', foreignAmount: 1000, currency: 'USD', fxRate: 1.0, openWs: 1000 },
    { id: 'b', number: 'INV-2', kind: 'invoice', foreignAmount: 100, currency: 'USD', fxRate: 1.0, openWs: 100 },
    { id: 'c', number: 'INV-3', kind: 'invoice', foreignAmount: 50, currency: 'EUR', fxRate: 1.0, openWs: 50 },
    { id: 'd', number: 'BILL-1', kind: 'bill', foreignAmount: 1000, currency: 'USD', fxRate: 1.0, openWs: 1000 },
  ], 'EUR', r);
  // USD weakened vs the 1.0 booked rate (1 USD = 0.8602 EUR now):
  // receivables lose, the owed bill gains.
  assert.equal(lines.length, 3);
  assert.ok(lines.filter((l) => l.kind === 'invoice').every((l) => l.diff < 0));
  assert.ok(lines.find((l) => l.kind === 'bill')!.diff > 0);
  assert.equal(lines[0].currency, 'USD');
});

test('revaluation journals balance per currency and use the right sides', () => {
  const coa = [
    { id: 'ar', type: 'asset', name: 'Accounts Receivable' },
    { id: 'ap', type: 'liability', name: 'Accounts Payable' },
    { id: 'gain', type: 'revenue', name: 'Other Income' },
    { id: 'loss', type: 'expense', name: 'Office' },
  ];
  const acc = resolveFxAccounts(coa);
  assert.ok(acc);
  const r = parseEcbXml(XML);
  const lines = revalueDocs([
    { id: 'a', number: 'INV-1', kind: 'invoice', foreignAmount: 1000, currency: 'USD', fxRate: 1.0, openWs: 1000 },
    { id: 'd', number: 'BILL-1', kind: 'bill', foreignAmount: 1000, currency: 'USD', fxRate: 1.0, openWs: 1000 },
  ], 'EUR', r);
  const journals: any[] = postFxRevaluation(lines, acc!, '2026-10');
  assert.equal(journals.length, 1);
  assert.equal(journals[0].externalRef, 'fx-reval:2026-10:USD');
  const dr = journals[0].lines.reduce((t: number, l: any) => t + l.debit, 0);
  const cr = journals[0].lines.reduce((t: number, l: any) => t + l.credit, 0);
  assert.ok(Math.abs(dr - cr) < 0.01 && dr > 0);
  // bill gain posts DR AP / CR gain
  const apDr = journals[0].lines.filter((l: any) => l.accountId === 'ap').reduce((t: number, l: any) => t + l.debit, 0);
  assert.ok(apDr > 0);
  assert.equal(resolveFxAccounts([]), null);
});

test('DCF: flat zero-growth company equals a perpetuity (margin / wacc)', () => {
  // No growth, full payout at 10% margin, 10% WACC, 0% terminal → EV = rev × margin / wacc
  const r = dcfValue({ revenue: 1000, growthPct: 0, fcfMarginPct: 10, waccPct: 10, years: 5, terminalGrowthPct: 0 });
  assert.ok(Math.abs(r.enterpriseValue - 1000) < 1.5, `got ${r.enterpriseValue}`);
});

test('DCF: growth raises value, WACC caps terminal growth below itself', () => {
  const flat = dcfValue({ revenue: 1000, growthPct: 0, fcfMarginPct: 10, waccPct: 12 });
  const growing = dcfValue({ revenue: 1000, growthPct: 30, fcfMarginPct: 10, waccPct: 12 });
  assert.ok(growing.enterpriseValue > flat.enterpriseValue);
  // terminal growth above the WACC is clamped, not crashed
  const capped = dcfValue({ revenue: 1000, growthPct: 5, fcfMarginPct: 10, waccPct: 10, terminalGrowthPct: 25 });
  assert.ok(Number.isFinite(capped.enterpriseValue));
  assert.equal(capped.rows.length, 5);
});
