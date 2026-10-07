import { buildFacts, extractPage, normalizeSiteUrl, pickPages, robotsAllows, type PageInfo, type WebFact } from './website-extract';
import { readTextCapped } from './website-text';

/**
 * Reads a company's own website for onboarding: the home page and up to five more (about, services, pricing, contact) on the same
 * site. Polite and bounded: it identifies itself, obeys robots.txt, never leaves the site's domain, reads at most 1.5 MB per page,
 * gives each request 8 seconds and the whole read 40, and goes through the same internal-address guard as every other outbound fetch.
 */

export const USER_AGENT = 'BorgaBot/1.0 (reads a company site its owner asked us to read for their knowledge base)';
const PAGE_BYTES = 1_500_000;
const REQUEST_MS = 8_000;
const TOTAL_MS = 40_000;
const MAX_EXTRA_PAGES = 5;

export class WebsiteError extends Error {}

export interface WebsiteRead {
  site: string;
  pages: Array<{ url: string; title: string }>;
  facts: WebFact[];
  skipped: Array<{ url: string; reason: string }>;
}

export type Get = (url: string, signal: AbortSignal) => Promise<Response>;

export async function readSite(input: string, get: Get): Promise<WebsiteRead> {
  const start = normalizeSiteUrl(input);
  if (!start) throw new WebsiteError('That does not look like a website address. Try something like acme.com.');
  const deadline = Date.now() + TOTAL_MS;
  const skipped: WebsiteRead['skipped'] = [];

  const fetchHtml = async (url: string): Promise<{ html: string; finalUrl: string } | null> => {
    if (Date.now() > deadline) { skipped.push({ url, reason: 'ran out of time' }); return null; }
    try {
      const res = await get(url, AbortSignal.timeout(REQUEST_MS));
      if (!res.ok) { skipped.push({ url, reason: `the site answered ${res.status}` }); return null; }
      const type = res.headers.get('content-type') ?? '';
      if (type && !/html|xml/i.test(type)) { skipped.push({ url, reason: 'not a web page' }); return null; }
      return { html: await readTextCapped(res, PAGE_BYTES), finalUrl: res.url || url };
    } catch (e) {
      const m = (e as Error).message ?? '';
      skipped.push({ url, reason: /internal|private|https|credentials/i.test(m) ? 'not allowed' : (e as Error).name === 'TimeoutError' ? 'took too long' : 'could not be reached' });
      return null;
    }
  };

  // robots.txt first: it applies to the site's own origin
  const origin = new URL(start).origin;
  let robots = '';
  try {
    const r = await get(`${origin}/robots.txt`, AbortSignal.timeout(REQUEST_MS));
    if (r.ok && /text|plain/i.test(r.headers.get('content-type') ?? 'text/plain')) robots = await readTextCapped(r, 200_000);
  } catch { /* no robots.txt, or it could not be fetched: nothing is forbidden */ }
  const path = (u: string) => { const x = new URL(u); return x.pathname + x.search; };
  if (!robotsAllows(robots, path(start))) throw new WebsiteError('This site asks automated readers not to read it (robots.txt). Add the details by hand instead.');

  const first = await fetchHtml(start);
  if (!first) throw new WebsiteError(`Could not read ${new URL(start).host}. Check the address, and that the site is public and uses https.${skipped[0] ? ` (${skipped[0].reason})` : ''}`);
  const home = extractPage(first.html, first.finalUrl);
  const siteOrigin = new URL(first.finalUrl).origin;

  const pages: PageInfo[] = [home];
  for (const url of pickPages(home, MAX_EXTRA_PAGES)) {
    if (new URL(url).origin !== siteOrigin) continue;
    if (!robotsAllows(robots, path(url))) { skipped.push({ url, reason: 'robots.txt asks readers to skip it' }); continue; }
    const got = await fetchHtml(url);
    if (!got || new URL(got.finalUrl).origin !== siteOrigin) { if (got) skipped.push({ url, reason: 'redirected to another site' }); continue; }
    pages.push(extractPage(got.html, got.finalUrl));
  }
  return { site: first.finalUrl, pages: pages.map((p) => ({ url: p.url, title: p.title })), facts: buildFacts(pages, first.finalUrl), skipped };
}
