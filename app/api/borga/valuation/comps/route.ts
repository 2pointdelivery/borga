import { NextResponse, type NextRequest } from 'next/server';
import { sessionUserId, featureGate } from '@/lib/borga/features-server';
import { edgarComps } from '@/lib/borga/valuation-history';

export const runtime = 'nodejs';

// GET ?ws=&tickers=AAPL,MSFT&cik_AAPL=0000320193&evrev_ACME=2.5 — native-first comps.
// Hand-entered evrev_<TICKER> multiples work fully offline (no external call);
// SEC EDGAR enrichment (free, no key) is best-effort per ticker. Non-US coverage labelled limited.
export async function GET(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const ws = url.searchParams.get('ws') ?? '';
  const gate = await featureGate('valuation', userId, ws);
  if (gate) return gate;
  const tickers = (url.searchParams.get('tickers') ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 10);
  const cikByTicker: Record<string, string> = {};
  const manualPeers: Array<{ ticker: string; evRev: number }> = [];
  for (const [k, v] of url.searchParams.entries()) {
    const cik = /^cik_(.+)$/i.exec(k);
    if (cik) cikByTicker[cik[1].toUpperCase()] = v;
    const ev = /^evrev_(.+)$/i.exec(k);
    if (ev && Number(v) > 0) {
      manualPeers.push({ ticker: ev[1].toUpperCase(), evRev: Number(v) });
      tickers.push(ev[1].toUpperCase());
    }
  }
  if (tickers.length === 0) return NextResponse.json({ ok: false, error: 'tickers required, e.g. ?tickers=AAPL,MSFT or &evrev_ACME=2.5 for a fully-offline manual peer' }, { status: 400 });
  const out = await edgarComps(fetch, [...new Set(tickers)], cikByTicker, { manualPeers });
  return NextResponse.json({ ok: true, ...out });
}
