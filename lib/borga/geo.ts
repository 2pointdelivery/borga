/**
 * Geography helpers shared by the server route, the dropdowns and the tests. Pure (no I/O).
 * Data: data/geo/*.json, derived from GeoNames (CC BY 4.0), see data/geo/ATTRIBUTION.md.
 */

export interface GeoCountry {
  /** ISO 3166-1 alpha-2 code. */
  c: string;
  n: string;
  /** ISO 4217 currency code of the country (may be empty). */
  cur: string;
  /** International dialling prefix, digits only. */
  ph: string;
}

export interface GeoState {
  /** GeoNames admin1 code (not always a letter code: Canada uses numbers). */
  c: string;
  n: string;
}

/** [name, state code, population] */
export type GeoCity = [name: string, state: string, population: number];

export interface CountryFile {
  s: GeoState[];
  p: GeoCity[];
}

/** Lower-case and strip accents, so "Montreal" finds "Montréal" and "Sao Paulo" finds "São Paulo". */
export const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Every typed word must appear in the text (accent and case insensitive). An empty query matches everything. */
export function matchesSearch(text: string, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold(text);
  return words.every((w) => hay.includes(w));
}

export const MAX_CITIES = 1500;

/**
 * Cities for a country, optionally narrowed to one state. Biggest first. A state is expected for countries that have states: the
 * list for a whole large country is capped (MAX_CITIES) so one request can never ship tens of thousands of rows.
 */
export function citiesFor(file: CountryFile, stateCode?: string): { cities: string[]; total: number } {
  const rows = stateCode ? file.p.filter((x) => x[1] === stateCode) : file.p;
  const names: string[] = [];
  const seen = new Set<string>();
  for (const [name] of rows) {
    if (seen.has(name)) continue; // the same name can exist in several states when no state is chosen
    seen.add(name);
    names.push(name);
  }
  return { cities: names.slice(0, MAX_CITIES), total: names.length };
}

/** Finds a country by name (case and accent insensitive) or by its ISO code. */
export function findCountry(list: GeoCountry[], nameOrCode: string): GeoCountry | undefined {
  const v = fold(nameOrCode.trim());
  if (!v) return undefined;
  return list.find((c) => fold(c.n) === v) ?? list.find((c) => c.c.toLowerCase() === v);
}

/** Finds a state by name or code inside one country's list. */
export function findState(list: GeoState[], nameOrCode: string): GeoState | undefined {
  const v = fold(nameOrCode.trim());
  if (!v) return undefined;
  return list.find((s) => fold(s.n) === v) ?? list.find((s) => s.c.toLowerCase() === v);
}
