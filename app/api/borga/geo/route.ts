import { NextResponse, type NextRequest } from 'next/server';
import { sessionUserId } from '@/lib/borga/features-server';
import { getCountries, getCountryFile } from '@/lib/borga/geo-server';
import { citiesFor } from '@/lib/borga/geo';

export const runtime = 'nodejs';

// The data never changes between releases, so the browser may keep each answer for a day.
const CACHE = { 'Cache-Control': 'private, max-age=86400' };

/**
 * GET ?type=countries
 * GET ?type=states&country=CA
 * GET ?type=cities&country=CA&state=08      (state is optional; without it the list is capped to the biggest cities)
 */
export async function GET(req: NextRequest) {
  if (!(await sessionUserId(req))) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const type = q.get('type');

  if (type === 'countries') {
    return NextResponse.json({ ok: true, countries: await getCountries() }, { headers: CACHE });
  }

  if (type === 'states' || type === 'cities') {
    const country = (q.get('country') ?? '').toUpperCase();
    const file = await getCountryFile(country);
    if (!file) return NextResponse.json({ ok: false, error: 'Unknown country code.' }, { status: 400 });
    if (type === 'states') return NextResponse.json({ ok: true, states: file.s }, { headers: CACHE });

    const state = q.get('state') ?? '';
    if (state && !/^[A-Za-z0-9.-]{1,10}$/.test(state)) return NextResponse.json({ ok: false, error: 'Invalid state code.' }, { status: 400 });
    const { cities, total } = citiesFor(file, state || undefined);
    return NextResponse.json({ ok: true, cities, total, capped: total > cities.length }, { headers: CACHE });
  }

  return NextResponse.json({ ok: false, error: 'type must be countries, states or cities.' }, { status: 400 });
}
