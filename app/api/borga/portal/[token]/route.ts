import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { acceptQuoteAsCustomer, portalView, verifyPortalToken } from '@/lib/borga/portal-server';

export const runtime = 'nodejs';

// Login-free customer portal API: the token in the path is the entire
// credential (constant-time verified, revoked/expired rejected). Rate limited
// by the proxy like all Borga traffic; unknown tokens all look identical (404).

const postSchema = z.object({ action: z.literal('accept'), quoteId: z.string().max(64) });

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const b = await verifyPortalToken(token);
  if (!b) return NextResponse.json({ ok: false, error: 'Link not found or expired.' }, { status: 404 });
  const view = await portalView(b);
  if (!view) return NextResponse.json({ ok: false, error: 'Account no longer available.' }, { status: 404 });
  return NextResponse.json({ ok: true, ...view });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const b = await verifyPortalToken(token);
  if (!b) return NextResponse.json({ ok: false, error: 'Link not found or expired.' }, { status: 404 });
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  const r = await acceptQuoteAsCustomer(b, parsed.data.quoteId);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, invoiceId: r.invoiceId, projectId: r.projectId, total: r.total });
}
