import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';
import { getApiKey } from '@/lib/borga/secrets';
import { workspaceSmtp } from '@/lib/borga/smtp-server';
import { makeTransport } from '@/lib/borga/smtp-transport';
import { fromHeader } from '@/lib/borga/smtp-core';
import { describeMailError, maildogConfig, type MailTransportConfig } from '@/lib/borga/maildog';

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

/**
 * The deployment's shared mail server: the SMTP_* settings, else MailDog (MAILDOG_USER and MAILDOG_PASSWORD, host mail.maildog.io),
 * else none. SMTP_HOST wins when both are present so an existing setup never changes underneath anyone.
 */
async function deploymentConfig(): Promise<MailTransportConfig | null> {
  const host = await getApiKey('SMTP_HOST');
  if (host) {
    const port = Number(await getApiKey('SMTP_PORT')) || 587;
    return {
      host,
      port,
      secure: (await getApiKey('SMTP_SECURE')) === 'true' || port === 465,
      user: await getApiKey('SMTP_USER'),
      pass: await getApiKey('SMTP_PASS'),
      from: await getApiKey('EMAIL_FROM'),
    };
  }
  return maildogConfig({
    MAILDOG_USER: await getApiKey('MAILDOG_USER'),
    MAILDOG_PASSWORD: await getApiKey('MAILDOG_PASSWORD'),
    MAILDOG_PORT: await getApiKey('MAILDOG_PORT'),
    MAILDOG_FROM: await getApiKey('MAILDOG_FROM'),
    EMAIL_FROM: await getApiKey('EMAIL_FROM'),
  });
}

export async function isEmailConfigured(ctx?: MailContext): Promise<boolean> {
  if (ctx && (await workspaceSmtp(ctx.userId, ctx.ws))) return true;
  const cfg = await deploymentConfig();
  return !!cfg?.host && !!cfg.from;
}

let cached: { sig: string; transport: Transporter } | null = null;

function getTransport(cfg: MailTransportConfig): Transporter {
  const { host, port, secure, user, pass } = cfg;
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
export async function sendThreadedEmail(opts: ThreadedMail, ctx?: MailContext): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const own = ctx ? await workspaceSmtp(ctx.userId, ctx.ws) : null;
  const shared = own ? null : await deploymentConfig();
  if (!own && !(shared?.host && shared.from)) return { ok: false, error: 'No mail server is set up.' };
  try {
    // the company's own server only accepts its own address as the sender: keep a display name if the caller gave one
    const nameOf = (h?: string) => /^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/.exec(h ?? '')?.[1]?.trim() ?? '';
    const from = own ? fromHeader({ fromAddress: own.fromAddress, fromName: nameOf(opts.from) || own.fromName }) : opts.from || shared!.from;
    const transport = own ? await makeTransport(own) : getTransport(shared!);
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
    // Said plainly, with the server's own words, and never the password: a send that fails must be diagnosable, not silent.
    const why = describeMailError(e);
    console.error(`[mailer] send to ${opts.to.replace(/(.{2}).*(@.*)/, '$1***$2')} failed: ${why.summary} (${why.detail})`);
    return { ok: false, error: why.summary };
  }
}

/** One-off account mail. Both parts are required: the plain-text one carries the links for clients that do not show HTML. */
export async function sendEmail(opts: { to: string; subject: string; html: string; text: string }): Promise<boolean> {
  // Account mail is machine-generated: tell auto-responders (out-of-office) not to answer it.
  const r = await sendThreadedEmail({ to: opts.to, subject: opts.subject, html: opts.html, text: opts.text, headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' } });
  return r.ok;
}
