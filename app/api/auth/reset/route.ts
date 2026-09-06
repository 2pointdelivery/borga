import { NextResponse } from 'next/server';
import { hashPassword, hashToken, verifyToken } from '@/lib/auth/password';
import { getUserByResetToken, updatePassword } from '@/lib/auth/queries';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const token = String(body?.token ?? '').trim();
    const password = String(body?.password ?? '');

    if (!token) {
      return NextResponse.json({ ok: false, error: 'Missing reset token.' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ ok: false, error: 'Password must be at least 8 characters.' }, { status: 400 });
    }

    // Look up by the hashed form of the supplied token so the raw token never
    // touches the database query directly.
    const user = await getUserByResetToken(hashToken(token));
    if (!user) {
      return NextResponse.json({ ok: false, error: 'This reset link is invalid or has expired.' }, { status: 400 });
    }

    await updatePassword(user.id, hashPassword(password));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not reset password.' }, { status: 500 });
  }
}
