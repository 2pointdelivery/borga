import { NextResponse, type NextRequest } from 'next/server';
import { featureGate } from '@/lib/borga/features-server';
import { isValidUserId, isValidWsId } from '@/lib/borga/keys';
import { ingestEmail, readInboundToken, verifyInboundToken, type InboundEmail } from '@/lib/borga/tickets-server';

export const runtime = 'nodejs';

/**
 * Public inbound-mail endpoint (exempt from the session cookie in proxy.ts;
 * authenticated by the per-workspace token instead).
 *
 *   POST /api/borga/tickets/inbound?u=<userId>&ws=<workspaceId>
 *   Authorization: Bearer <inbound token>     (or X-Inbound-Token)
 *
 * Accepts: generic JSON {from, fromName, subject, text, html, messageId,
 * inReplyTo, references[], headers{}}, Postmark inbound JSON, and Mailgun
 * routes (form-encoded). Cloudflare Email Routing / any mail-to-webhook
 * bridge can post the generic shape.
 */

const MAX_BYTES = 1_000_000;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

function fromPostmark(j: Record<string, unknown>): InboundEmail {
  const full = (j.FromFull ?? {}) as { Email?: string; Name?: string };
  const headers: Record<string, string> = {};
  for (const h of (Array.isArray(j.Headers) ? j.Headers : []) as Array<{ Name?: string; Value?: string }>) {
    if (h?.Name) headers[h.Name.toLowerCase()] = String(h.Value ?? '');
  }
  return {
    from: full.Email ?? str(j.From) ?? '',
    fromName: full.Name ?? str(j.FromName),
    subject: str(j.Subject) ?? '',
    text: str(j.TextBody),
    html: str(j.HtmlBody),
    // Postmark's own MessageID is not the RFC Message-ID; prefer the header so replies thread.
    messageId: headers['message-id'] ?? str(j.MessageID),
    inReplyTo: headers['in-reply-to'],
    references: headers['references']?.split(/\s+/).filter(Boolean),
    headers,
  };
}

function fromGeneric(j: Record<string, unknown>): InboundEmail {
  const refs = Array.isArray(j.references) ? j.references.filter((x): x is string => typeof x === 'string') : str(j.references)?.split(/\s+/);
  const headers = j.headers && typeof j.headers === 'object' ? Object.fromEntries(Object.entries(j.headers as Record<string, unknown>).map(([k, v]) => [k, String(v)])) : {};
  return {
    from: str(j.from) ?? '',
    fromName: str(j.fromName),
    subject: str(j.subject) ?? '',
    text: str(j.text),
    html: str(j.html),
    messageId: str(j.messageId),
    inReplyTo: str(j.inReplyTo),
    references: refs,
    headers,
  };
}

function fromForm(f: FormData): InboundEmail {
  const g = (k: string) => str(f.get(k));
  const sender = g('from') ?? g('sender') ?? '';
  const named = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(sender);
  return {
    from: named ? named[2] : sender,
    fromName: named?.[1]?.trim() || undefined,
    subject: g('subject') ?? '',
    text: g('body-plain') ?? g('text'),
    html: g('body-html') ?? g('html'),
    messageId: g('Message-Id') ?? g('message-id'),
    inReplyTo: g('In-Reply-To'),
    references: g('References')?.split(/\s+/).filter(Boolean),
    headers: {
      'auto-submitted': g('Auto-Submitted') ?? '',
      precedence: g('Precedence') ?? '',
      'list-id': g('List-Id') ?? '',
    },
  };
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const u = url.searchParams.get('u');
  const ws = url.searchParams.get('ws');
  if (!isValidUserId(u) || !isValidWsId(ws)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const provided = (req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? req.headers.get('x-inbound-token') ?? '').trim();
  const expected = await readInboundToken(u, ws);
  if (!expected || !verifyInboundToken(provided, expected)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const gate = await featureGate('tickets', u, ws);
  if (gate) return gate;

  if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES) return NextResponse.json({ ok: false, error: 'Payload too large' }, { status: 413 });

  let mail: InboundEmail;
  try {
    const ct = req.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const raw = await req.text();
      if (raw.length > MAX_BYTES) return NextResponse.json({ ok: false, error: 'Payload too large' }, { status: 413 });
      const j = JSON.parse(raw) as Record<string, unknown>;
      mail = 'TextBody' in j || 'HtmlBody' in j || 'FromFull' in j ? fromPostmark(j) : fromGeneric(j);
    } else if (ct.includes('form')) {
      mail = fromForm(await req.formData());
    } else {
      return NextResponse.json({ ok: false, error: 'Unsupported content type' }, { status: 415 });
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
  }

  try {
    return NextResponse.json(await ingestEmail(u, ws, mail));
  } catch (e) {
    console.error('[tickets/inbound] ingest failed', e);
    // 5xx makes mail bridges retry; the Message-ID dedupe row makes retries safe.
    return NextResponse.json({ ok: false, error: 'ingest failed' }, { status: 500 });
  }
}
