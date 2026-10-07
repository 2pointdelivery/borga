import { COMPOSIO_ENTITY } from '@/lib/borga/connected-apps';

const HEADERS = { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' };

export interface MailResult {
  ok: boolean;
  /** Which route delivered it, for the log. */
  via?: 'Gmail' | 'your mail server';
  note?: string;
}

/**
 * Send one email as the company. Gmail (connected once under Integrations, wherever it was connected) goes first; when there is no
 * Gmail, the company's own mail server (SMTP) sends it. Whichever is missing, the message says what to set up, once.
 */
export async function sendCompanyEmail(m: { ws: string; to: string; subject: string; body: string; composioKey?: string; replyTo?: string }): Promise<MailResult> {
  let gmailError = '';
  try {
    const res = await fetch('/api/borga/composio', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        action: 'execute', appName: 'GMAIL_SEND_EMAIL', entityId: COMPOSIO_ENTITY, ...(m.composioKey ? { apiKey: m.composioKey } : {}),
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
      body: JSON.stringify({ to: m.to.trim(), subject: m.subject.trim(), body: m.body.trim(), ...(m.replyTo ? { replyTo: m.replyTo } : {}) }),
    });
    const d = (await res.json()) as { ok?: boolean; error?: string };
    if (d.ok) return { ok: true, via: 'your mail server' };
    // 409 = no mail server either: the Gmail answer is the useful one, plus where to set either up
    if (res.status === 409) return { ok: false, note: `${gmailError} Connect Gmail or add your mail server (SMTP) under Integrations → Connected Apps.` };
    return { ok: false, note: d.error ?? gmailError };
  } catch {
    return { ok: false, note: gmailError };
  }
}
