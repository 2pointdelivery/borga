import { NextResponse } from 'next/server';
import { sessionCookieName, isSecureContext } from '@/lib/auth/session';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookieName(), '', {
    path: '/',
    secure: isSecureContext(req),
    maxAge: 0,
  });
  return res;
}
