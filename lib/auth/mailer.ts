import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';
import { getApiKey } from '@/lib/borga/secrets';
import { workspaceSmtp } from '@/lib/borga/smtp-server';
import { makeTransport } from '@/lib/borga/smtp-transport';
import { fromHeader } from '@/lib/borga/smtp-core';

// Reusable SMTP mailer. Configure via env or the secrets store:
//   SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS,
//   SMTP_SECURE (set "true" for port 465), EMAIL_FROM
// When unconfigured, `isEmailConfigured()` is false and callers can fall back
// to a dev link (see /api/auth/forgot).

/** Which company a mail is for. With it, the company's own SMTP server is used when it has set one. */
export interface MailContext {
  userId: string;
  ws: string;
}

export async function isEmailConfigured(ctx?: MailContext): Promise<boolean> {
  if (ctx && (await workspaceSmtp(ctx.userId, ctx.ws))) return true;
  const host = await getApiKey('SMTP_HOST');
  const from = await getApiKey('EMAIL_FROM');
  return !!host && !!from;
}

let cached: { sig: string; transport: Transporter } | null = null;

async function getTransport(): Promise<Transporter> {
  const host = await getApiKey('SMTP_HOST');
  const port = Number(await getApiKey('SMTP_PORT')) || 587;
  const secure = (await getApiKey('SMTP_SECURE')) === 'true' || port === 465;
  const user = await getApiKey('SMTP_USER');
  const pass = await getApiKey('SMTP_PASS');
  // Rebuild when settings change in the dashboard; a process-lifetime cache would keep stale credentials.
  const sig = [host, port, secure, user, pass].join('|');
  if (!cached || cached.sig !== sig) {
    cached = {
      sig,
      transport: nodemailer.createTransport({ host, port, secure, auth: user ? { user, pass } : undefined }),
    };
  }
  return cached.transport;
}

export interface ThreadedMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Overrides EMAIL_FROM, e.g. "Support <help@acme.com>". */
  from?: string;
  replyTo?: string;
  inReplyTo?: string;
  references?: string[];
  headers?: Record<string, string>;
}

/** Sends with threading headers and returns the generated Message-ID so replies can be matched back. */
export async function sendThreadedEmail(opts: ThreadedMail, ctx?: MailContext): Promise<{ ok: boolean; messageId?: string }> {
  const own = ctx ? await workspaceSmtp(ctx.userId, ctx.ws) : null;
  if (!own && !(await isEmailConfigured())) return { ok: false };
  try {
    // the company's own server only accepts its own address as the sender: keep a display name if the caller gave one
    const nameOf = (h?: string) => /^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/.exec(h ?? '')?.[1]?.trim() ?? '';
    const from = own ? fromHeader({ fromAddress: own.fromAddress, fromName: nameOf(opts.from) || own.fromName }) : opts.from || (await getApiKey('EMAIL_FROM'));
    const transport = own ? await makeTransport(own) : await getTransport();
    const info = await transport.sendMail({
      from,
      to: opts.to,
      replyTo: opts.replyTo,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      inReplyTo: opts.inReplyTo,
      references: opts.references,
      headers: opts.headers,
    });
    if (own) transport.close();
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    console.error('[mailer] threaded send failed:', e);
    return { ok: false };
  }
}

/** One-off account mail. Both parts are required: the plain-text one carries the links for clients that do not show HTML. */
export async function sendEmail(opts: { to: string; subject: string; html: string; text: string }): Promise<boolean> {
  // Account mail is machine-generated: tell auto-responders (out-of-office) not to answer it.
  const r = await sendThreadedEmail({ to: opts.to, subject: opts.subject, html: opts.html, text: opts.text, headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' } });
  return r.ok;
}
