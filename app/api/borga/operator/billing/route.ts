import { NextResponse, type NextRequest } from 'next/server';
import { operatorFromRequest } from '@/lib/auth/operator';
import { isValidUserId, isValidWsId } from '@/lib/borga/keys';
import { BillingUserError, setComped } from '@/lib/borga/billing-server';

export const runtime = 'nodejs';

// POST /api/borga/operator/billing { userId, ws, comped }: deployment administrator only. A comped workspace is not charged.
export async function POST(req: NextRequest) {
  if (!(await operatorFromRequest(req))) return NextResponse.json({ ok: false, error: 'Only the deployment administrator can change billing.' }, { status: 403 });
  let body: { userId?: unknown; ws?: unknown; comped?: unknown };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 }); }
  if (!isValidUserId(body.userId) || !isValidWsId(body.ws) || typeof body.comped !== 'boolean') return NextResponse.json({ ok: false, error: 'userId, ws and comped are required.' }, { status: 400 });
  try {
    await setComped(body.userId, body.ws, body.comped);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof BillingUserError) return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    throw e;
  }
}
