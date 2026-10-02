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

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<boolean> {
  const r = await sendThreadedEmail({
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text ?? opts.html.replace(/<[^>]+>/g, ''),
  });
  return r.ok;
}

export function buildResetEmailHtml(opts: { name: string; resetUrl: string }): string {
  const { name, resetUrl } = opts;
  return `<!doctype html>
<html>
  <body style="margin:0;background:#0b0b12;color:#e7e7ef;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:480px;margin:0 auto;padding:32px 20px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
        <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(120deg,#6366f1,#0ea5e9);"></div>
        <span style="font-size:20px;font-weight:700;">Borga</span>
      </div>
      <h1 style="font-size:22px;margin:0 0 12px;">Reset your password</h1>
      <p style="line-height:1.5;color:#b9b9c9;margin:0 0 20px;">
        Hi ${name ? name.replace(/</g, '&lt;') : 'there'}, we received a request to reset your Borga password.
        This link expires in 1 hour.
      </p>
      <a href="${resetUrl}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px;">
        Choose a new password
      </a>
      <p style="line-height:1.5;color:#8a8a9a;font-size:13px;margin:24px 0 0;">
        If you didn't request this, you can safely ignore this email. Your password won't change.
      </p>
    </div>
  </body>
</html>`;
}
