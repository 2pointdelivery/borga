import { lookup } from 'dns/promises';
import { isIP } from 'net';

/** True for loopback, private, link-local (incl. cloud metadata 169.254.169.254), CGNAT and ULA addresses. */
export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === '::1' || x === '::') return true;
    if (x.startsWith('::ffff:')) return isPrivateIp(x.slice(7));
    return /^f[cd]/.test(x) || /^fe[89ab]/.test(x);
  }
  return true; // not an IP literal: callers resolve first
}

async function assertPublicAddresses(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('URL resolves to a private or internal address.');
}

/**
 * Validates an outbound webhook target: https only and every resolved address public.
 * Resolving here (not just pattern-matching the hostname) defeats names that point at
 * internal hosts. Pair with `redirect: 'manual'` on the fetch.
 */
export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('Webhook URLs must use https.');
  await assertPublicAddresses(url);
  return url;
}

/** Throws unless the URL is http(s) (https only unless `allowHttp`), carries no credentials and resolves only to public addresses. */
export async function assertPublicUrl(raw: string, opts: { allowHttp?: boolean } = {}): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'https:' && !(opts.allowHttp && url.protocol === 'http:')) throw new Error('Only https:// URLs are allowed.');
  if (url.username || url.password) throw new Error('URLs with embedded credentials are not allowed.');
  await assertPublicAddresses(url);
  return url;
}

/**
 * Fetches a user-supplied URL without letting it reach internal hosts. Every hop (the first
 * request and each redirect) is re-validated, because a public page can redirect to
 * http://169.254.169.254/ or to a name that resolves to a private address.
 * Known limit: the name is resolved here and again by fetch(), so DNS rebinding between the two
 * is not prevented; keep the host's firewall closed to internal services as the second layer.
 */
export async function fetchPublic(
  raw: string,
  init: RequestInit = {},
  opts: { allowHttp?: boolean; maxRedirects?: number } = {},
): Promise<Response> {
  let current = raw;
  for (let hop = 0; hop <= (opts.maxRedirects ?? 4); hop++) {
    const url = new URL(current);
    if (url.protocol !== 'https:' && !(opts.allowHttp && url.protocol === 'http:')) throw new Error('Only https:// URLs are allowed.');
    if (url.username || url.password) throw new Error('URLs with embedded credentials are not allowed.');
    await assertPublicAddresses(url);
    const res = await fetch(url, { ...init, redirect: 'manual' });
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!loc) return res;
    current = new URL(loc, url).href;
  }
  throw new Error('Too many redirects.');
}

/** Reads at most `maxBytes` of a response body as text, so a huge page cannot exhaust memory. */
export async function readTextCapped(res: Response, maxBytes = 1_500_000): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, maxBytes));
}
