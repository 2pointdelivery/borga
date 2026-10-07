// Stateless, signed session tokens (HMAC-SHA256 via Web Crypto).
// Works in both Edge middleware and Node route handlers — no Node-specific APIs.

const COOKIE_NAME = 'borga_session';
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 16) return secret;
  // A public fallback would let anyone forge session cookies, so production refuses to run without a real secret.
  if (process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET (16+ chars) must be set in production');
  return 'dev-insecure-session-secret-change-me';
}

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Constant-time string compare so signature checks do not leak prefix matches. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmac(data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return b64url(new Uint8Array(sig));
}

export interface Session {
  userId: string;
  expiresAt: number;
}

export function sessionCookieName(): string {
  return COOKIE_NAME;
}

export function sessionMaxAge(): number {
  return MAX_AGE_MS;
}

/** Whether the session cookie should be marked Secure (only over HTTPS). */
export function isSecureContext(req: Request): boolean {
  try {
    if (new URL(req.url).protocol === 'https:') return true;
  } catch {
    // ignore
  }
  const fwd = req.headers.get('x-forwarded-proto');
  return !!fwd && fwd.split(',')[0].trim() === 'https';
}

/** Build a signed token for a user. Format: `<userId>.<expiry>.<signature>`. */
export async function createSessionToken(userId: string): Promise<string> {
  const expiresAt = Date.now() + MAX_AGE_MS;
  const payload = `${userId}.${expiresAt}`;
  const sig = await hmac(payload);
  return `${payload}.${sig}`;
}

/** Verify a token's signature + expiry. Returns the userId or null. */
export async function verifySessionToken(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, expStr, sig] = parts;
  if (!userId || !expStr || !sig) return null;
  const expected = await hmac(`${userId}.${expStr}`);
  if (!safeEqual(expected, sig)) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  // A signed-out or reset session is refused here, so every route and the proxy honour it. Needs the database, so it is skipped
  // where there is none; a database error never locks everyone out (the signature and expiry above already held).
  if (typeof window === 'undefined' && process.env.DATABASE_URL) {
    try {
      const { isSessionRevoked } = await import('./session-revocation');
      if (await isSessionRevoked(userId, token, exp, MAX_AGE_MS)) return null;
    } catch {
      /* fail open on infrastructure errors */
    }
  }
  return userId;
}

/**
 * Lightweight, signature-free claim parse for Edge middleware/proxy.
 * Confirms the token is well-formed and not expired; the cryptographic
 * signature is re-checked by the Node API routes (the authoritative gate),
 * so a forged token is still rejected there.
 */
export function parseSessionClaims(
  token: string | undefined | null,
): { userId: string; expiresAt: number } | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, expStr] = parts;
  if (!userId || !expStr) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  return { userId, expiresAt: exp };
}
