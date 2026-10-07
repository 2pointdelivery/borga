/**
 * The client address used to key rate limits. Edge-safe and pure.
 *
 * The app runs behind one reverse proxy (Caddy), which sets X-Forwarded-For to the real peer address. A client can send its own
 * X-Forwarded-For too, and a proxy that appends puts the real address LAST, so the right-most value is the only one a client
 * cannot choose. (The left-most value, which this used to read, is whatever the client wrote: rotating it gave unlimited
 * fresh rate-limit buckets.) deploy/Caddyfile also overwrites the header, so there is exactly one value.
 */

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-fA-F:]{2,45}$/;

/** True for something shaped like an IP address; rejects free text so a hostile header cannot create arbitrary limiter keys. */
export function looksLikeIp(v: string): boolean {
  if (v.length > 45) return false;
  if (IPV4.test(v)) return v.split('.').every((o) => Number(o) <= 255);
  return v.includes(':') && IPV6.test(v);
}

export function clientIp(headers: { get(name: string): string | null }): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && looksLikeIp(last)) return last.toLowerCase();
  }
  const real = headers.get('x-real-ip')?.trim();
  if (real && looksLikeIp(real)) return real.toLowerCase();
  return 'unknown';
}
