import 'server-only';
import { lookup } from 'dns/promises';
import nodemailer, { type Transporter } from 'nodemailer';
import { isPrivateIp } from './safe-url';
import { explainSmtpError, type SmtpSettings } from './smtp-core';

/**
 * A transport for these settings. The host name is resolved here and the connection is made to the address that was checked, so a
 * name that points at an internal service is refused and cannot change between the check and the connection (the certificate
 * is still checked against the real host name). Encryption is never optional: a server that cannot do STARTTLS is refused.
 */
export async function makeTransport(s: SmtpSettings): Promise<Transporter> {
  const addrs = await lookup(s.host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw Object.assign(new Error('The SMTP server resolves to an internal address.'), { code: 'EINTERNAL' });
  }
  const target = (addrs.find((a) => a.family === 4) ?? addrs[0]).address;
  return nodemailer.createTransport({
    host: target,
    port: s.port,
    secure: s.secure,
    requireTLS: !s.secure,
    auth: s.user ? { user: s.user, pass: s.password } : undefined,
    tls: { servername: s.host, minVersion: 'TLSv1.2' },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

export interface MaildogSandboxCredentials {
  host: string;
  port: number;
  user: string;
  password: string;
  inboundAddress: string;
  expiresAt?: string;
}

/**
 * Provisions a fresh 24-hour MailDog public SMTP sandbox (`pub_...` on port 2525).
 * Used when a workspace uses MailDog's public sandbox and its 24h credentials have expired.
 */
export async function provisionMaildogSandbox(): Promise<MaildogSandboxCredentials | null> {
  try {
    const res = await fetch('https://maildog.io/api/public-sandbox/create', {
      method: 'POST',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      smtp_host?: string;
      smtp_port?: number;
      smtp_username?: string;
      smtp_password?: string;
      demo_inbound_address?: string;
      expires_at?: string;
    };
    if (!data.smtp_username || !data.smtp_password) return null;
    return {
      host: data.smtp_host || 'mail.maildog.io',
      port: Number(data.smtp_port) || 2525,
      user: data.smtp_username,
      password: data.smtp_password,
      inboundAddress: data.demo_inbound_address || `${data.smtp_username}@sandbox.smtp.maildog.io`,
      expiresAt: data.expires_at,
    };
  } catch {
    return null;
  }
}

export interface SmtpCheck {
  ok: boolean;
  message: string;
  refreshedValues?: Record<string, string>;
}

/** Connects and logs in without sending anything. Auto-refreshes expired MailDog `pub_` sandboxes. */
export async function verifySmtp(s: SmtpSettings): Promise<SmtpCheck> {
  try {
    const t = await makeTransport(s);
    await t.verify();
    t.close();
    return { ok: true, message: `Connected to ${s.host} on port ${s.port}${s.user ? ' and signed in' : ''}.` };
  } catch (e) {
    const err = e as { code?: string; responseCode?: number; message?: string };
    if (err.code === 'EINTERNAL') {
      return { ok: false, message: 'That server name points at an internal address, which is not allowed.' };
    }
    // If this is a MailDog public sandbox (`pub_...`) whose 24-hour credentials expired,
    // automatically provision a fresh MailDog sandbox and verify it.
    const isAuthErr = err.code === 'EAUTH' || err.responseCode === 535 || err.responseCode === 534;
    if (isAuthErr && s.host === 'mail.maildog.io' && (!s.user || s.user.startsWith('pub_'))) {
      const fresh = await provisionMaildogSandbox();
      if (fresh) {
        const nextSettings: SmtpSettings = {
          ...s,
          host: fresh.host,
          port: fresh.port,
          secure: false,
          user: fresh.user,
          password: fresh.password,
        };
        try {
          const t2 = await makeTransport(nextSettings);
          await t2.verify();
          t2.close();
          return {
            ok: true,
            message: `Connected to ${fresh.host} on port ${fresh.port} and signed in.`,
            refreshedValues: {
              host: fresh.host,
              port: String(fresh.port),
              secure: 'no',
              user: fresh.user,
              password: fresh.password,
            },
          };
        } catch {
          // Fall through to standard error explanation
        }
      }
    }
    return { ok: false, message: explainSmtpError(err) };
  }
}
