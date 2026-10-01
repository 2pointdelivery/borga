import { createHmac, timingSafeEqual } from 'crypto';

/** Pure signature checks for provider webhooks (unit-tested; no I/O). */

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** Meta: header `X-Hub-Signature-256: sha256=<hex hmac of raw body keyed by app secret>`. */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`;
  return safeEqual(header.trim(), expected);
}

/**
 * Twilio: `X-Twilio-Signature` = base64(HMAC-SHA1(authToken, url + sorted "key"+"value" of POST params)).
 * `url` must be exactly what Twilio called (scheme, host, path and query).
 */
export function twilioSignature(url: string, params: Record<string, string>, authToken: string): string {
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

export function verifyTwilioSignature(url: string, params: Record<string, string>, header: string | null, authToken: string): boolean {
  if (!header || !authToken) return false;
  return safeEqual(header.trim(), twilioSignature(url, params, authToken));
}
