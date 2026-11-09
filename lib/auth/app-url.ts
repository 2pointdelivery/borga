/**
 * The public address of this deployment, for links that go into emails.
 *
 * APP_URL wins. Without it the request's own origin is used while developing, but never in production: the origin comes from the
 * Host header, which a visitor can set, so a reset link built from it could point at the attacker's site and hand them the token.
 */
export function appOrigin(req: Request): string | null {
  const env = (process.env.APP_URL ?? '').trim().replace(/\/+$/, '');
  if (/^https?:\/\/[^\s]+$/.test(env)) return env;
  if (process.env.NODE_ENV === 'production') return null;
  try { return new URL(req.url).origin; } catch { return null; }
}
