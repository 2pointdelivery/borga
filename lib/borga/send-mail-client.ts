import { COMPOSIO_ENTITY } from '@/lib/borga/connected-apps';
import type { BusinessDocumentEmailInput } from '@/lib/borga/email-core';

const HEADERS = { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' };

export interface MailResult {
  ok: boolean;
  /** Which route delivered it, for the log. */
  via?: 'Gmail' | 'your mail server';
  note?: string;
}

/**
 * Send one email (or formatted business document: Invoice, Quote, Bill, Purchase Order) as the company.
 * When `document` is provided, `/api/borga/mail` is preferred first so the recipient receives the
 * rich Stripe/Resend/Hemrock HTML table + plain-text breakdown; otherwise Gmail (Composio) is tried
 * first and `/api/borga/mail` (workspace SMTP / Postmark / MailDog) is the automatic fallback.
 */
export async function sendCompanyEmail(m: {
  ws: string;
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
  document?: BusinessDocumentEmailInput;
}): Promise<MailResult> {
  // If sending a structured business document (Invoice, Quote, Bill, PO), try /api/borga/mail first
  // so the recipient gets the rich HTML line-item template.
  if (m.document) {
    try {
      const res = await fetch(`/api/borga/mail?ws=${encodeURIComponent(m.ws)}`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          to: m.to.trim(),
          subject: m.subject.trim(),
          body: m.body.trim(),
          ...(m.replyTo ? { replyTo: m.replyTo } : {}),
          document: m.document,
        }),
      });
      const d = (await res.json()) as { ok?: boolean; error?: string };
      if (d.ok) return { ok: true, via: 'your mail server' };
    } catch {
      // Fall through to Gmail / standard fallback
    }
  }

  let gmailError = '';
  try {
    const res = await fetch('/api/borga/composio', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        action: 'execute',
        appName: 'GMAIL_SEND_EMAIL',
        entityId: COMPOSIO_ENTITY,
        ws: m.ws,
        params: { recipient_email: m.to.trim(), subject: m.subject.trim(), body: m.body.trim() },
      }),
    });
    const d = (await res.json()) as { ok?: boolean; error?: string };
    if (d.ok) return { ok: true, via: 'Gmail' };
    gmailError = /not found or not authorized/i.test(d.error ?? '') ? 'Gmail is not connected.' : d.error ?? 'Gmail did not send it.';
  } catch {
    gmailError = 'Could not reach the send service.';
  }

  try {
    const res = await fetch(`/api/borga/mail?ws=${encodeURIComponent(m.ws)}`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        to: m.to.trim(),
        subject: m.subject.trim(),
        body: m.body.trim(),
        ...(m.replyTo ? { replyTo: m.replyTo } : {}),
        ...(m.document ? { document: m.document } : {}),
      }),
    });
    const d = (await res.json()) as { ok?: boolean; error?: string };
    if (d.ok) return { ok: true, via: 'your mail server' };
    if (res.status === 409) {
      return {
        ok: false,
        note: `${gmailError} Outgoing email (SMTP) is not configured — add your mail server under Integrations → Connections.`,
      };
    }
    return { ok: false, note: d.error ?? gmailError };
  } catch {
    return { ok: false, note: gmailError };
  }
}

export async function sendCompanySms(m: {
  ws: string;
  to: string;
  body: string;
}): Promise<{ ok: boolean; sid?: string; note?: string }> {
  try {
    const res = await fetch('/api/borga/sms', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ ws: m.ws, to: m.to.trim(), body: m.body.trim() }),
    });
    const d = (await res.json()) as { ok?: boolean; sid?: string; error?: string };
    if (d.ok) return { ok: true, sid: d.sid };
    return {
      ok: false,
      note: d.error ?? 'Twilio SMS is not configured — add your Twilio credentials under Integrations → Connections.',
    };
  } catch {
    return { ok: false, note: 'Network error reaching the SMS service.' };
  }
}
