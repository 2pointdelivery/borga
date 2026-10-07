import { NextResponse, type NextRequest } from 'next/server';
import { sessionCookieName, isSecureContext, parseSessionClaims, verifySessionToken } from '@/lib/auth/session';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // End this session for real (not just the cookie), or every session when asked: a copied cookie stops working too.
  const token = req.cookies.get(sessionCookieName())?.value;
  const claims = parseSessionClaims(token);
  if (token && claims && (await verifySessionToken(token))) {
    const body = (await req.json().catch(() => ({}))) as { everywhere?: boolean };
    try {
      const { revokeToken, revokeAllSessions } = await import('@/lib/auth/session-revocation');
      if (body.everywhere === true) await revokeAllSessions(claims.userId);
      else await revokeToken(claims.userId, token, claims.expiresAt);
    } catch (e) {
      console.error('Could not record the sign-out', e);
    }
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookieName(), '', {
    path: '/',
    secure: isSecureContext(req),
    maxAge: 0,
  });
  return res;
}
