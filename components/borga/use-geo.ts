'use client';

import { useEffect, useState } from 'react';
import { findCountry, findState, type GeoCountry, type GeoState } from '@/lib/borga/geo';

// Each answer is fetched once per page load and shared by every dropdown. A failed fetch is not cached, so the next open retries.
const cache = new Map<string, Promise<unknown>>();

function load<T>(url: string, pick: (j: any) => T): Promise<T> {
  let p = cache.get(url) as Promise<T> | undefined;
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(pick);
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

interface Loaded<T> {
  data: T;
  loading: boolean;
}

function useLoaded<T>(url: string | null, pick: (j: any) => T, empty: T): Loaded<T> {
  const [state, setState] = useState<{ url: string | null; data: T }>({ url: null, data: empty });
  useEffect(() => {
    if (!url) return;
    let alive = true;
    load(url, pick)
      .then((data) => alive && setState({ url, data }))
      .catch(() => alive && setState({ url, data: empty }));
    return () => {
      alive = false;
    };
    // pick and empty are constants of the caller
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  // loading until the answer for the CURRENT url has arrived (so switching country never shows the previous country's list)
  return { data: state.url === url ? state.data : empty, loading: !!url && state.url !== url };
}

const NO_COUNTRIES: GeoCountry[] = [];
const NO_STATES: GeoState[] = [];
const NO_CITIES: string[] = [];

export const useCountries = () => useLoaded('/api/borga/geo?type=countries', (j) => j.countries as GeoCountry[], NO_COUNTRIES);

/** States of a country given by its NAME (the form stores names). Resolves the code through the country list. */
export function useStates(countryName: string) {
  const { data: countries } = useCountries();
  const country = countryName ? findCountry(countries, countryName) : undefined;
  const r = useLoaded(country ? `/api/borga/geo?type=states&country=${country.c}` : null, (j) => j.states as GeoState[], NO_STATES);
  return { ...r, country };
}

/** Cities of a country (and state, when one is chosen), both given by NAME. */
export function useCities(countryName: string, stateName: string) {
  const { country, data: states, loading: statesLoading } = useStates(countryName);
  const state = stateName ? findState(states, stateName) : undefined;
  // A country with states lists cities per state; before a state is picked we offer the country's biggest cities.
  const url = country && !statesLoading ? `/api/borga/geo?type=cities&country=${country.c}${state ? `&state=${encodeURIComponent(state.c)}` : ''}` : null;
  const r = useLoaded(url, (j) => j.cities as string[], NO_CITIES);
  return { ...r, loading: r.loading || statesLoading, country, hasStates: states.length > 0 };
}
