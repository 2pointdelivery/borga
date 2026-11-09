import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CountryFile, GeoCountry } from './geo';

/** Reads data/geo/*.json (GeoNames, CC BY 4.0). Files are parsed once and kept in memory: about 4 MB for the whole world. */
const dir = path.join(process.cwd(), 'data', 'geo');

let countries: GeoCountry[] | null = null;
const files = new Map<string, CountryFile>();

export async function getCountries(): Promise<GeoCountry[]> {
  if (!countries) countries = JSON.parse(await fs.readFile(path.join(dir, 'countries.json'), 'utf8')) as GeoCountry[];
  return countries;
}

/** Returns null for a code that is not a country in the data (the code selects a file, so it is validated, never joined blindly). */
export async function getCountryFile(code: string): Promise<CountryFile | null> {
  if (!/^[A-Z]{2}$/.test(code)) return null;
  const cached = files.get(code);
  if (cached) return cached;
  if (!(await getCountries()).some((c) => c.c === code)) return null;
  const file = JSON.parse(await fs.readFile(path.join(dir, `${code}.json`), 'utf8')) as CountryFile;
  files.set(code, file);
  return file;
}
