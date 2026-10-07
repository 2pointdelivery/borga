import 'server-only';
import crypto from 'node:crypto';

// Password hashing using Node's built-in scrypt (no extra dependency).
// Storage format: `<saltHex>:<hashHex>` where both are 32+ byte hex strings.

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const computed = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(computed, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Reset tokens are single-use, random, and stored only as an HMAC so a leaked
// database dump can't be used to reset passwords. We use a keyed HMAC (rather
// than scrypt) so the stored value is deterministic and can be looked up
// directly in the database without iterating over every user.
function resetSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET (16+ chars) must be set in production');
  return 'borga-reset-v1';
}

export function hashToken(token: string): string {
  return crypto.createHmac('sha256', resetSecret()).update(token).digest('hex');
}

export function verifyToken(token: string, stored: string): boolean {
  const computed = hashToken(token);
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(stored, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
