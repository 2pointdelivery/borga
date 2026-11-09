#!/usr/bin/env node
// Builds data/geo/*.json (countries, states/provinces, cities) from GeoNames, licensed CC BY 4.0 (attribution required: see
// data/geo/ATTRIBUTION.md). The generated files are committed so builds never need the network; run this only to refresh them:
//
//   node scripts/build-geo.mjs                 download from download.geonames.org, then generate
//   node scripts/build-geo.mjs --dir <folder>  use already downloaded countryInfo.txt, admin1CodesASCII.txt, cities1000.txt
//
// Output
//   data/geo/countries.json   [{ c: "CA", n: "Canada", cur: "CAD", ph: "1" }, ...] sorted by name
//   data/geo/<CC>.json        { s: [{ c: "08", n: "Ontario" }], p: [["Toronto", "08", 2731571], ...] }  cities by population
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'data', 'geo');
const dirArg = process.argv.indexOf('--dir');
const BASE = 'https://download.geonames.org/export/dump/';

/** Reads the first (and only) file of a simple deflate/stored ZIP archive, which is how GeoNames ships cities1000.zip. */
function unzipFirst(buf) {
  // local file header signature 0x04034b50
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('not a zip file');
  // sizes can be zero in the local header when a data descriptor is used, so read them from the central directory
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('zip end record not found');
  const cd = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error('zip central directory not found');
  const method = buf.readUInt16LE(cd + 10);
  const compressedSize = buf.readUInt32LE(cd + 20);
  const lho = buf.readUInt32LE(cd + 42);
  const nameLen = buf.readUInt16LE(lho + 26);
  const extraLen = buf.readUInt16LE(lho + 28);
  const data = buf.subarray(lho + 30 + nameLen + extraLen, lho + 30 + nameLen + extraLen + compressedSize);
  return method === 0 ? data : zlib.inflateRawSync(data);
}

async function load() {
  if (dirArg > 0) {
    const d = process.argv[dirArg + 1];
    return {
      countryInfo: fs.readFileSync(path.join(d, 'countryInfo.txt'), 'utf8'),
      admin1: fs.readFileSync(path.join(d, 'admin1CodesASCII.txt'), 'utf8'),
      cities: fs.readFileSync(path.join(d, 'cities1000.txt'), 'utf8'),
    };
  }
  const get = async (f) => Buffer.from(await (await fetch(BASE + f)).arrayBuffer());
  console.log('downloading from GeoNames...');
  const [ci, a1, zip] = await Promise.all([get('countryInfo.txt'), get('admin1CodesASCII.txt'), get('cities1000.zip')]);
  return { countryInfo: ci.toString('utf8'), admin1: a1.toString('utf8'), cities: unzipFirst(zip).toString('utf8') };
}

const { countryInfo, admin1, cities } = await load();

// ── countries ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const countries = [];
for (const line of countryInfo.split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const f = line.split('\t');
  if (f.length < 15 || !/^[A-Z]{2}$/.test(f[0])) continue;
  countries.push({ c: f[0], n: f[4], cur: f[10] || '', ph: (f[12] || '').replace(/[^0-9]/g, '') });
}
countries.sort((a, b) => a.n.localeCompare(b.n, 'en'));
const known = new Set(countries.map((c) => c.c));

// ── states / provinces (GeoNames "admin1") ────────────────────────────────────────────────────────────────────────────
const states = new Map(); // CC -> [{c, n}]
for (const line of admin1.split('\n')) {
  if (!line) continue;
  const [key, name] = line.split('\t');
  const [cc, code] = key.split('.');
  if (!known.has(cc) || !code || !name) continue;
  if (!states.has(cc)) states.set(cc, []);
  states.get(cc).push({ c: code, n: name });
}

// ── cities (populated places with more than 1,000 people) ─────────────────────────────────────────────────────────────
const byCountry = new Map(); // CC -> Map("name|admin1" -> [name, admin1, population])
for (const line of cities.split('\n')) {
  if (!line) continue;
  const f = line.split('\t');
  const cc = f[8];
  if (!known.has(cc)) continue;
  const name = f[1];
  const a1 = f[10] || '';
  const pop = Number(f[14]) || 0;
  if (!byCountry.has(cc)) byCountry.set(cc, new Map());
  const m = byCountry.get(cc);
  const k = `${name}|${a1}`;
  const prev = m.get(k);
  if (!prev || prev[2] < pop) m.set(k, [name, a1, pop]); // same name twice in one state: keep the larger
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'countries.json'), JSON.stringify(countries));

let totalCities = 0;
let totalStates = 0;
for (const { c } of countries) {
  const list = [...(byCountry.get(c)?.values() ?? [])].sort((a, b) => b[2] - a[2] || a[0].localeCompare(b[0], 'en'));
  const st = (states.get(c) ?? []).sort((a, b) => a.n.localeCompare(b.n, 'en'));
  totalCities += list.length;
  totalStates += st.length;
  fs.writeFileSync(path.join(out, `${c}.json`), JSON.stringify({ s: st, p: list }));
}

fs.writeFileSync(
  path.join(out, 'ATTRIBUTION.md'),
  `# Geographic data

Countries, states/provinces and cities in this folder are derived from GeoNames (https://www.geonames.org), which is licensed under
the Creative Commons Attribution 4.0 license (https://creativecommons.org/licenses/by/4.0/). Contains data from GeoNames.

Generated by \`scripts/build-geo.mjs\` from countryInfo.txt, admin1CodesASCII.txt and cities1000.txt (places with more than 1,000
people). Changes made: fields were reduced to name, state code and population, duplicate names inside one state were merged, and
the data was split into one file per country.
`,
);

const bytes = fs.readdirSync(out).reduce((s, f) => s + fs.statSync(path.join(out, f)).size, 0);
console.log(`countries ${countries.length}, states ${totalStates}, cities ${totalCities}, files ${fs.readdirSync(out).length}, ${(bytes / 1e6).toFixed(1)} MB (${path.relative(root, out)})`);
void os;
