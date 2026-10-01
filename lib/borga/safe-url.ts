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

/**
 * Validates an outbound webhook target: https only and every resolved address public.
 * Resolving here (not just pattern-matching the hostname) defeats names that point at
 * internal hosts. Pair with `redirect: 'manual'` on the fetch.
 */
export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('Webhook URLs must use https.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('Webhook URL resolves to a private or internal address.');
  return url;
}
