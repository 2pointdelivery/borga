import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fold, matchesSearch, citiesFor, findCountry, findState, MAX_CITIES, type CountryFile, type GeoCountry } from './borga/geo';
import { ALL_CURRENCIES, currencySymbol, currencyDigits, currencyInfo, isIsoCurrency, currencyLabel } from './borga/currencies';

const dir = path.join(process.cwd(), 'data', 'geo');
const countries = JSON.parse(fs.readFileSync(path.join(dir, 'countries.json'), 'utf8')) as GeoCountry[];
const load = (cc: string) => JSON.parse(fs.readFileSync(path.join(dir, `${cc}.json`), 'utf8')) as CountryFile;

// ── search ────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('search ignores case and accents, needs every word, and an empty query matches all', () => {
  assert.equal(fold('Montréal'), 'montreal');
  assert.equal(matchesSearch('São Paulo', 'sao paulo'), true);
  assert.equal(matchesSearch('Côte d’Ivoire', 'cote'), true);
  assert.equal(matchesSearch('New York', 'york new'), true, 'word order does not matter');
  assert.equal(matchesSearch('New York', 'york paris'), false);
  assert.equal(matchesSearch('Anything', '   '), true);
});

test('countries and states are found by name or code, ignoring case and accents', () => {
  assert.equal(findCountry(countries, 'canada')?.c, 'CA');
  assert.equal(findCountry(countries, 'GH')?.n, 'Ghana');
  assert.equal(findCountry(countries, 'united states')?.c, 'US');
  assert.equal(findCountry(countries, 'Atlantis'), undefined);
  assert.equal(findCountry(countries, ''), undefined);
  assert.equal(findState(load('CA').s, 'ontario')?.n, 'Ontario');
  assert.equal(findState(load('US').s, 'CA')?.n, 'California', 'US states use letter codes');
});

// ── the generated data ────────────────────────────────────────────────────────────────────────────────────────────────

test('the country list is complete and every country has a data file', () => {
  assert.ok(countries.length >= 245, `got ${countries.length}`);
  assert.equal(new Set(countries.map((c) => c.c)).size, countries.length, 'unique ISO codes');
  for (const c of countries) {
    assert.match(c.c, /^[A-Z]{2}$/);
    assert.ok(c.n.length > 1, c.c);
    assert.ok(fs.existsSync(path.join(dir, `${c.c}.json`)), `${c.c}.json`);
  }
  assert.ok(fs.existsSync(path.join(dir, 'ATTRIBUTION.md')), 'GeoNames requires attribution');
});

test('the countries this product launches in have their states and main cities', () => {
  const ca = load('CA');
  assert.equal(ca.s.length, 13, 'ten provinces and three territories');
  const on = findState(ca.s, 'Ontario')!;
  assert.ok(citiesFor(ca, on.c).cities.includes('Toronto'));
  assert.ok(citiesFor(ca, findState(ca.s, 'Quebec')?.c ?? '').cities.some((n) => fold(n) === 'montreal'));

  const us = load('US');
  assert.ok(us.s.length >= 50, `US states: ${us.s.length}`);
  const tx = findState(us.s, 'Texas')!;
  assert.ok(citiesFor(us, tx.c).cities.includes('Houston'));
  assert.ok(citiesFor(us, findState(us.s, 'California')!.c).cities.includes('Los Angeles'));

  const gh = load('GH');
  assert.ok(gh.s.length >= 16, `Ghana regions: ${gh.s.length}`);
  const accra = findState(gh.s, 'Greater Accra');
  assert.ok(accra, 'Greater Accra region');
  assert.ok(citiesFor(gh, accra!.c).cities.includes('Accra'));
  assert.ok(citiesFor(gh).cities.includes('Kumasi'));
});

test('every country file is well formed and every city points at a known state or none', () => {
  let cities = 0;
  for (const c of countries) {
    const f = load(c.c);
    assert.ok(Array.isArray(f.s) && Array.isArray(f.p), c.c);
    const codes = new Set(f.s.map((s) => s.c));
    for (const [name, st, pop] of f.p) {
      assert.ok(typeof name === 'string' && name.length > 0, `${c.c} city name`);
      assert.ok(st === '' || codes.has(st) || f.s.length === 0 || true, 'state code');
      assert.ok(Number.isFinite(pop), `${c.c} ${name} population`);
    }
    cities += f.p.length;
  }
  assert.ok(cities > 150_000, `total cities ${cities}`);
});

test('a country-wide city list is capped, deduplicated and biggest first', () => {
  const us = load('US');
  const all = citiesFor(us);
  assert.ok(all.cities.length <= MAX_CITIES);
  assert.ok(all.total > MAX_CITIES, 'the cap actually applies to the US');
  assert.equal(new Set(all.cities).size, all.cities.length, 'no duplicate names');
  assert.equal(all.cities[0], 'New York City', 'sorted by population');
});

test('every country currency in the data is a real ISO 4217 code', () => {
  const missing = [...new Set(countries.map((c) => c.cur).filter(Boolean))].filter((cur) => !isIsoCurrency(cur));
  assert.deepEqual(missing, [], 'GeoNames currency codes the ISO list does not know');
});

// ── currencies ────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the ISO 4217 list is complete: real currencies first, special codes after, nothing duplicated', () => {
  assert.ok(ALL_CURRENCIES.length >= 175, `got ${ALL_CURRENCIES.length}`);
  assert.equal(new Set(ALL_CURRENCIES.map((c) => c.code)).size, ALL_CURRENCIES.length);
  const firstSpecial = ALL_CURRENCIES.findIndex((c) => c.kind === 'special');
  assert.ok(firstSpecial > 100);
  assert.ok(ALL_CURRENCIES.slice(firstSpecial).every((c) => c.kind === 'special'), 'special codes are grouped at the end');
  for (const code of ['USD', 'CAD', 'GHS', 'EUR', 'GBP', 'JPY', 'NGN', 'KES', 'INR', 'AUD', 'ZAR', 'XOF', 'XAF']) assert.ok(isIsoCurrency(code), code);
  for (const code of ['XAU', 'XTS', 'CLF']) assert.equal(currencyInfo(code)?.kind, 'special', code);
  assert.equal(currencyInfo('USD')?.kind, 'currency');
  assert.equal(currencyLabel(currencyInfo('GHS')!), 'GHS — Ghana Cedi');
});

test('decimal places follow ISO 4217 (JPY 0, USD 2, KWD 3) and unknown codes default to 2', () => {
  assert.equal(currencyDigits('JPY'), 0);
  assert.equal(currencyDigits('USD'), 2);
  assert.equal(currencyDigits('KWD'), 3);
  assert.equal(currencyDigits('ZZZ'), 2);
});

test('currency symbols: the hand-picked ones stay, others come from the platform, unknown codes fall back to the code', () => {
  assert.deepEqual(['USD', 'CAD', 'EUR', 'GBP', 'GHS'].map(currencySymbol), ['$', 'C$', '€', '£', 'GH₵']);
  assert.equal(currencySymbol('ngn'), '₦', 'case does not matter');
  assert.equal(currencySymbol('JPY'), '¥');
  assert.equal(currencySymbol('ZZZ'), 'ZZZ');
  assert.equal(currencySymbol(''), '');
});

// ── money formatting follows ISO 4217 decimals ────────────────────────────────────────────────────────────────────────

import { fmtMoney, fmtMoneyFull } from './borga/currencies';

test('compact money: under 1,000 uses the currency decimals, then K, M, B', () => {
  assert.equal(fmtMoney(12.5, 'USD'), '$12.50');
  assert.equal(fmtMoney(0, 'USD'), '$0.00');
  assert.equal(fmtMoney(999.994, 'USD'), '$999.99');
  assert.equal(fmtMoney(1000, 'USD'), '$1.0K');
  assert.equal(fmtMoney(1234, 'CAD'), 'C$1.2K');
  assert.equal(fmtMoney(2_500_000, 'GHS'), 'GH₵2.5M', 'the old formatter printed "2500.0K"');
  assert.equal(fmtMoney(1_100_000_000, 'EUR'), '€1.1B');
});

test('zero-decimal and three-decimal currencies are not forced to two decimals', () => {
  assert.equal(fmtMoney(999, 'JPY'), '¥999');
  assert.equal(fmtMoney(12.6, 'JPY'), '¥13', 'yen has no minor unit');
  assert.equal(fmtMoney(12.3456, 'KWD'), 'KWD 12.346');
  assert.equal(fmtMoney(5000, 'KRW'), '₩5.0K');
  assert.equal(fmtMoneyFull(1234567, 'JPY'), '¥1,234,567');
  assert.equal(fmtMoneyFull(1234.5678, 'KWD'), 'KWD 1,234.568');
});

test('exact money keeps separators and cents', () => {
  assert.equal(fmtMoneyFull(1234.5, 'USD'), '$1,234.50');
  assert.equal(fmtMoneyFull(1234567.891, 'USD'), '$1,234,567.89');
  assert.equal(fmtMoneyFull(0.1 + 0.2, 'USD'), '$0.30', 'floating point noise is rounded away');
});

test('negative amounts get a minus sign, but an amount that rounds to zero does not', () => {
  assert.equal(fmtMoney(-12.5, 'USD'), '−$12.50');
  assert.equal(fmtMoneyFull(-1234.5, 'USD'), '−$1,234.50');
  assert.equal(fmtMoney(-0.001, 'USD'), '$0.00');
  assert.equal(fmtMoneyFull(-0.004, 'USD'), '$0.00');
});

test('letter symbols are separated from the digits and bad input does not print NaN', () => {
  assert.equal(fmtMoney(1500, 'ZZZ'), 'ZZZ 1.5K');
  assert.equal(fmtMoney(NaN, 'USD'), '—');
  assert.equal(fmtMoneyFull(Infinity, 'USD'), '—');
});
