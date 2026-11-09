// Valuation snapshots (real history, replaces illustrative HISTORY_1Y) + SEC EDGAR market comps.
// EDGAR is free, no key: companyfacts + submissions JSON. Price source is optional/free-tier key.
// All comps carry as-of date, source and sample size; CA/GH coverage is labelled limited.
import type { ValuationFacts } from './data';

export interface ValuationSnapshot { at: string; fmv: number; revenue: number; multiple: number; ev: number; source: 'manual' | 'cron' | 'api'; note?: string; }
export const EMPTY_SNAPSHOTS: ValuationSnapshot[] = [];

/** A hand-kept peer multiple — the native comps ledger (no network, no key). */
export interface ValuationPeer { id: string; ticker: string; name: string; evRev: number; note?: string; updatedAt: string; }
export const EMPTY_PEERS: ValuationPeer[] = [];

export function peerMedian(peers: ValuationPeer[]): number | null {
  const ms = peers.map((p) => p.evRev).filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  return ms.length ? ms[Math.floor(ms.length / 2)] : null;
}

/** True when no snapshot exists for the snapshot's calendar month (cron uses this to save monthly). */
export function monthSnapshotted(snaps: ValuationSnapshot[], atIso = new Date().toISOString()): boolean {
  return snaps.some((s) => s.at.slice(0, 7) === atIso.slice(0, 7));
}

export function takeSnapshot(v: ValuationFacts, source: ValuationSnapshot['source'] = 'manual', note?: string): ValuationSnapshot {
  return { at: new Date().toISOString(), fmv: v.fmv, revenue: v.revenue, multiple: v.multiple, ev: v.ev, source, note };
}

export interface EdgarComp { ticker: string; name: string; revenue: number | null; ev: number | null; evRev: number | null; asOf: string; source: 'manual' | 'edgar'; }
export interface CompsResult { comps: EdgarComp[]; medianEvRev: number | null; source: string; asOf: string; sampleSize: number; limited: boolean; }

/** A peer multiple entered by hand — the native path: no network, no key, works offline. */
export interface ManualPeer { ticker: string; name?: string; evRev: number; }

type Fetch = typeof fetch;
const UA = { 'User-Agent': 'Borga valuation (contact: valuation@borga.local)', Accept: 'application/json' };

async function edgarJson(f: Fetch, url: string): Promise<Record<string, any> | null> {
  try {
    const r = await f(url, { headers: UA, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    return (await r.json()) as Record<string, any>;
  } catch { return null; }
}

/** TTM revenue from SEC companyfacts (Revenues/RevenueFromContractWithCustomer, USD). */
export async function edgarRevenue(f: Fetch, cik10: string): Promise<{ revenue: number | null; asOf: string }> {
  const j = await edgarJson(f, `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik10}.json`);
  const facts = (j?.facts?.['us-gaap'] ?? {}) as Record<string, { units?: Record<string, Array<{ end?: string; val?: number; frame?: string }>> }>;
  for (const tag of ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet']) {
    const units = facts[tag]?.units?.USD;
    if (!units?.length) continue;
    const annual = units.filter((u) => /-12-31$/.test(u.end ?? '') && typeof u.val === 'number').sort((a, b) => (b.end ?? '').localeCompare(a.end ?? ''));
    const latest = annual[0];
    if (latest?.val) return { revenue: latest.val, asOf: latest.end ?? '' };
  }
  return { revenue: null, asOf: '' };
}

/** Shares outstanding from submissions (commonStockSharesOutstanding) + free price hook (optional). */
export async function edgarComps(
  f: Fetch,
  tickers: string[],
  cikByTicker: Record<string, string>,
  opts: { manualPeers?: ManualPeer[]; priceByTicker?: Record<string, number> } = {},
): Promise<CompsResult> {
  const asOf = new Date().toISOString().slice(0, 10);
  const comps: EdgarComp[] = [];
  // Native first: hand-entered multiples need no network and never fail.
  for (const m of (opts.manualPeers ?? []).slice(0, 10)) {
    if (!(m.evRev > 0)) continue;
    comps.push({ ticker: m.ticker.toUpperCase(), name: m.name ?? m.ticker.toUpperCase(), revenue: null, ev: null, evRev: m.evRev, asOf, source: 'manual' });
  }
  // EDGAR enrichment is best-effort per ticker: one failure never breaks the rest.
  for (const t of tickers.slice(0, 10)) {
    if (comps.some((c) => c.ticker === t.toUpperCase())) continue;
    const cik = cikByTicker[t.toUpperCase()];
    if (!cik) { comps.push({ ticker: t.toUpperCase(), name: t.toUpperCase(), revenue: null, ev: null, evRev: null, asOf, source: 'edgar' }); continue; }
    const { revenue } = await edgarRevenue(f, cik.padStart(10, '0'));
    const price = opts.priceByTicker?.[t.toUpperCase()];
    // EV needs market cap (price × shares) + net debt; without a price feed we report revenue only and mark limited.
    comps.push({ ticker: t.toUpperCase(), name: t.toUpperCase(), revenue, ev: null, evRev: null, asOf, source: 'edgar' });
    void price;
  }
  const multiples = comps.map((c) => c.evRev).filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  const median = multiples.length ? multiples[Math.floor(multiples.length / 2)] : null;
  const nativeOnly = comps.length > 0 && comps.every((c) => c.source === 'manual');
  return {
    comps, medianEvRev: median,
    source: nativeOnly
      ? 'Manual peer multiples (native, offline — no external call made).'
      : 'Manual peers (native) + SEC EDGAR companyfacts (free, no key; best-effort per ticker). EV/Revenue needs a price feed or hand-entered multiple — connect one or enter market caps manually.',
    asOf, sampleSize: comps.length, limited: true,
  };
}
