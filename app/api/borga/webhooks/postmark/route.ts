import { NextResponse, type NextRequest } from 'next/server';
import { applyPostmarkEvent, postmarkWebhookConfigured, verifyPostmarkWebhook } from '@/lib/borga/postmark-server';

export const runtime = 'nodejs';

const MAX_BODY = 1_000_000;

/**
 * Postmark event webhook (bounce / complaint / delivery / open / click).
 * Configure it in Postmark (server -> webhooks) with HTTP Basic Auth; the
 * credentials live in POSTMARK_WEBHOOK_USER / POSTMARK_WEBHOOK_PASS.
 * It carries no session, so the route checks Basic auth itself (constant
 * time) and answers 401/503 without touching state. Parseable events never
 * 500: Postmark retries non-2xx, so only transport-level failures retry.
 */
export async function POST(req: NextRequest) {
  if (!postmarkWebhookConfigured()) {
    return NextResponse.json({ ok: false, error: 'Postmark webhook is not configured.' }, { status: 503 });
  }
  if (!verifyPostmarkWebhook(req.headers.get('authorization'))) {
    return NextResponse.json({ ok: false, error: 'Bad credentials.' }, { status: 401 });
  }
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) {
    return NextResponse.json({ ok: false, error: 'Too large.' }, { status: 413 });
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ ok: false, error: 'Too large.' }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: 'Bad event.' }, { status: 400 });
  }
  const out = await applyPostmarkEvent(body);
  return NextResponse.json({ ok: true, ...out });
}
