import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireWorkspace, tooManyRequests } from '@/lib/borga/request-guard';
import { takeRouteLimit } from '@/lib/borga/route-limits';
import { workspaceSmtp } from '@/lib/borga/smtp-server';
import { isEmailConfigured, sendThreadedEmail } from '@/lib/auth/mailer';
import { renderBusinessDocumentEmail } from '@/lib/borga/email-core';
import { documentTotals } from '@/lib/borga/pricing';

export const runtime = 'nodejs';

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

const DocumentLineSchema = z.object({
  label: z.string().max(240),
  qty: z.number().finite(),
  unitPrice: z.number().finite(),
  amount: z.number().finite().optional(),
});

const DocumentSchema = z.object({
  kind: z.enum(['invoice', 'quote', 'bill', 'purchase_order']),
  workspaceName: z.string().max(120),
  documentNumber: z.string().max(60),
  recipientName: z.string().max(120),
  currency: z.string().max(8),
  totalAmount: z.number().finite(),
  issuedDate: z.string().max(40).optional(),
  dueOrValidDate: z.string().max(40).optional(),
  statusLabel: z.string().max(40).optional(),
  message: z.string().max(5000).optional(),
  lines: z.array(DocumentLineSchema).max(100).optional(),
  subtotalAmount: z.number().finite().optional(),
  discountAmount: z.number().finite().optional(),
  taxRate: z.number().finite().min(0).max(100).optional(),
  taxAmount: z.number().finite().optional(),
  ctaUrl: z.string().max(500).optional(),
  ctaLabel: z.string().max(80).optional(),
});

const body = z.object({
  to: z.string().max(254).regex(EMAIL),
  subject: z.string().max(300),
  body: z.string().min(1).max(20_000),
  replyTo: z.string().max(254).regex(EMAIL).optional(),
  document: DocumentSchema.optional(),
});

/** GET ?ws= -> whether the company has its own mail server or deployment mail configured. */
export async function GET(req: NextRequest) {
  const ws = new URL(req.url).searchParams.get('ws');
  const g = await requireWorkspace(req, ws);
  if (!g.ok) return g.res;
  const own = await workspaceSmtp(g.userId, g.ws);
  const ready = !!own || (await isEmailConfigured({ userId: g.userId, ws: g.ws }));
  return NextResponse.json({
    ok: true,
    smtp: ready,
    via: own ? 'workspace' : ready ? 'shared' : 'none',
    from: own?.fromAddress ?? null,
  });
}

/**
 * POST ?ws= -> send one message or formatted business document (Invoice, Quote, Bill, Purchase Order).
 * Uses the workspace's own SMTP server when configured, or falls back to the deployment's
 * configured Postmark / SMTP / MailDog transport.
 *
 * The document's totals are recalculated here from its lines: the browser can
 * choose the tax rate and the discount, never the amount the recipient sees.
 */
export async function POST(req: NextRequest) {
  const ws = new URL(req.url).searchParams.get('ws');
  const g = await requireWorkspace(req, ws, { csrf: true });
  if (!g.ok) return g.res;

  const limit = takeRouteLimit('mail', `${g.userId}:${g.ws}`);
  if (limit.limited) return tooManyRequests(limit.retryAfterSec, 'Too many messages sent. Try again later.');

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'A valid recipient and a message are required.' }, { status: 400 });
  }
  const ctx = { userId: g.userId, ws: g.ws };
  if (!(await isEmailConfigured(ctx))) {
    return NextResponse.json(
      { ok: false, error: 'No mail server is configured — add SMTP settings under Integrations → Connections, or connect Gmail.' },
      { status: 409 },
    );
  }
  const m = parsed.data;
  let doc = m.document;
  if (doc?.lines?.length) {
    const totals = documentTotals(doc.lines, { taxRate: doc.taxRate, discountAmount: doc.discountAmount, currency: doc.currency });
    doc = { ...doc, subtotalAmount: totals.subtotal, discountAmount: totals.discount, taxAmount: totals.tax, totalAmount: totals.total };
  }
  const renderedDoc = doc ? renderBusinessDocumentEmail(doc) : null;
  const r = await sendThreadedEmail(
    {
      to: m.to,
      subject: m.subject || renderedDoc?.subject || '(no subject)',
      text: renderedDoc ? `${m.body}\n\n${renderedDoc.text}` : m.body,
      html: renderedDoc?.html,
      replyTo: m.replyTo,
    },
    ctx,
  );
  return r.ok
    ? NextResponse.json({ ok: true, provider: r.provider })
    : NextResponse.json({ ok: false, error: r.error ?? 'The mail server did not accept the message.' }, { status: 502 });
}
