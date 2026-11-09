import { NextResponse, type NextRequest } from 'next/server';
import { runSharedReport, verifyShareToken } from '@/lib/borga/custom-reports-server';

export const runtime = 'nodejs';

// Read-only shared report: the token in the path is the whole credential
// (hash-verified, revocable, expiring). Unknown/revoked/expired → same 404.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const b = await verifyShareToken(token);
  if (!b) return NextResponse.json({ ok: false, error: 'Link not found or expired.' }, { status: 404 });
  const r = await runSharedReport(b);
  if (!r) return NextResponse.json({ ok: false, error: 'Report no longer available.' }, { status: 404 });
  return NextResponse.json({ ok: true, ...r });
}
