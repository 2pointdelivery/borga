/**
 * Customer portal: pure rules for token-scoped, login-free access. A portal
 * token belongs to one customer account in one workspace and reveals only
 * that account's invoices and quotes — never the dashboard, never anyone
 * else's documents. I/O lives in portal-server.ts.
 */

export const PORTAL_TOKEN_PREFIX = 'bpt_';

export interface PortalToken {
  id: string;
  customerId: string;
  customerName: string;
  /** sha256 of the token: the secret itself is shown once and never stored. */
  hash: string;
  /** First chars for the owner's list (which link is which). */
  prefix: string;
  createdAt: string;
  /** ISO date; null means it never expires. */
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

export interface PortalTokenPublic extends Omit<PortalToken, 'hash'> {}

/** A token that is revoked or past expiry verifies as invalid — a silent revoke. */
export function isPortalTokenLive(t: PortalToken, nowIso: string = new Date().toISOString()): boolean {
  if (t.revokedAt) return false;
  if (t.expiresAt && t.expiresAt < nowIso.slice(0, 10)) return false;
  return true;
}

/** Token shape check before any hash work: prefix + 32+ base64url chars. */
export function isPortalTokenFormat(token: unknown): token is string {
  return typeof token === 'string' && new RegExp(`^${PORTAL_TOKEN_PREFIX}[A-Za-z0-9\\-_]{32,}$`).test(token);
}

/** Quotes a customer may see: everything but unsent drafts. */
export function isPortalVisibleQuote(status: string): boolean {
  return status !== 'draft';
}

/** Quotes a customer may accept themselves: sent and still in date. */
export function isPortalAcceptable(status: string, validUntil: string, todayIso: string): boolean {
  return status === 'sent' && validUntil >= todayIso;
}

/** Default expiry for new links (90 days), as an ISO date. */
export function defaultPortalExpiry(now: Date = new Date()): string {
  return new Date(now.getTime() + 90 * 86_400_000).toISOString().slice(0, 10);
}
