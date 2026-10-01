import 'server-only';
import { assertPublicHttpsUrl } from './safe-url';
import { extractRecords, nextPageUrl } from './crm-core';

/**
 * Safe, paginated HTTP client for a company's own API (the "Company Engine").
 * The target URL is user-supplied and fetched from our server, so it goes through the same
 * SSRF guard as outbound webhooks: https only, every resolved address public, no redirects.
 * Local development (or BORGA_ALLOW_PRIVATE_ENGINE=1 for a CRM on a private network) relaxes this.
 */

export interface EngineConfig {
  baseUrl: string;
  apiKey: string;
  authHeader?: string;
  authPrefix?: string;
  customersPath?: string;
  leadsPath?: string;
  listKey?: string;
}

export type EngineResource = 'customers' | 'leads';

export function engineConfigFrom(values: Record<string, string> | null | undefined): EngineConfig | null {
  if (!values?.baseUrl) return null;
  return {
    baseUrl: values.baseUrl.trim().replace(/\/+$/, ''),
    apiKey: values.apiKey ?? '',
    authHeader: values.authHeader?.trim() || undefined,
    authPrefix: values.authPrefix,
    customersPath: values.customersPath?.trim() || undefined,
    leadsPath: values.leadsPath?.trim() || undefined,
    listKey: values.listKey?.trim() || undefined,
  };
}

export const privateEngineAllowed = (): boolean => process.env.NODE_ENV !== 'production' || process.env.BORGA_ALLOW_PRIVATE_ENGINE === '1';

/** Throws a readable error when the URL may not be fetched from the server. */
export async function guardEngineUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('The engine URL is not a valid address.');
  }
  if (privateEngineAllowed()) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('The engine URL must start with https://');
    return url;
  }
  return assertPublicHttpsUrl(raw);
}

export function authHeaders(cfg: EngineConfig): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (cfg.apiKey) {
    const prefix = cfg.authPrefix === undefined || cfg.authPrefix === '' ? 'Bearer ' : /^none$/i.test(cfg.authPrefix.trim()) ? '' : cfg.authPrefix.endsWith(' ') ? cfg.authPrefix : cfg.authPrefix + ' ';
    headers[cfg.authHeader || 'Authorization'] = prefix + cfg.apiKey;
  }
  return headers;
}

const DEFAULT_PATH: Record<EngineResource, string> = { customers: '/customers', leads: '/leads' };

export function resourceUrl(cfg: EngineConfig, resource: EngineResource): string {
  const p = (resource === 'customers' ? cfg.customersPath : cfg.leadsPath) || DEFAULT_PATH[resource];
  return cfg.baseUrl + (p.startsWith('/') ? p : '/' + p);
}

export type FetchResult =
  | { ok: true; rows: Array<Record<string, unknown>>; pages: number; truncated: boolean }
  | { ok: false; error: string; status?: number };

const PAGE_TIMEOUT_MS = 15_000;
const MAX_PAGES = 10;
const MAX_RECORDS = 1000;

function httpError(status: number, what: string): string {
  if (status === 401 || status === 403) return `The API rejected the credentials (HTTP ${status}). Check the API key and the auth header.`;
  if (status === 404) return `Not found (HTTP 404): check the ${what} path.`;
  if (status === 429) return 'The API is rate limiting us (HTTP 429). Try again shortly.';
  return `The API answered HTTP ${status}.`;
}

/** Fetches every page of a resource (following the API's own `next` links) up to the safety caps. */
export async function fetchResource(cfg: EngineConfig, resource: EngineResource, f: typeof fetch = fetch, limits = { maxPages: MAX_PAGES, maxRecords: MAX_RECORDS }): Promise<FetchResult> {
  let url = resourceUrl(cfg, resource);
  const rows: Array<Record<string, unknown>> = [];
  let pages = 0;
  let truncated = false;
  try {
    while (url) {
      await guardEngineUrl(url);
      const res = await f(url, { headers: authHeaders(cfg), redirect: 'manual', signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
      if (res.status >= 300 && res.status < 400) return { ok: false, status: res.status, error: 'The API redirected the request. Use the final URL (no redirects are followed).' };
      if (!res.ok) return { ok: false, status: res.status, error: httpError(res.status, resource) };
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        return { ok: false, status: res.status, error: 'The API did not return JSON.' };
      }
      const page = extractRecords(json, cfg.listKey);
      if (!page) return { ok: false, status: res.status, error: cfg.listKey ? `No list found at "${cfg.listKey}" in the response.` : 'Could not find a list of records in the response. Set "List key" to the field that holds the array.' };
      rows.push(...page);
      pages++;
      if (rows.length >= limits.maxRecords) {
        truncated = true;
        rows.length = limits.maxRecords;
        break;
      }
      const next = nextPageUrl(json, url);
      if (!next) break;
      if (pages >= limits.maxPages) {
        truncated = true;
        break;
      }
      url = next;
    }
    return { ok: true, rows, pages, truncated };
  } catch (e) {
    const err = e as Error;
    return { ok: false, error: err.name === 'TimeoutError' ? 'The API did not answer within 15 seconds.' : err.message };
  }
}

/** Connection check: fetch the first page of customers and describe what came back. */
export async function testEngine(cfg: EngineConfig, f: typeof fetch = fetch): Promise<{ ok: boolean; message: string; details?: string[] }> {
  if (!cfg.apiKey) return { ok: false, message: 'Save the API key first.' };
  const r = await fetchResource(cfg, 'customers', f, { maxPages: 1, maxRecords: 50 });
  if (!r.ok) return { ok: false, message: r.error };
  const sample = r.rows[0];
  return {
    ok: true,
    message: `Connected. ${r.rows.length}${r.truncated ? '+' : ''} customer record(s) on the first page.`,
    details: sample ? ['Fields seen: ' + Object.keys(sample).slice(0, 12).join(', ')] : ['The list is empty, which is fine if you have no customers yet.'],
  };
}
