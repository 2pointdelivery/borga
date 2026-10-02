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
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw Object.assign(new Error('The SMTP server resolves to an internal address.'), { code: 'EINTERNAL' });
  const target = (addrs.find((a) => a.family === 4) ?? addrs[0]).address;
  return nodemailer.createTransport({
    host: target, port: s.port, secure: s.secure, requireTLS: !s.secure, auth: s.user ? { user: s.user, pass: s.password } : undefined,
    tls: { servername: s.host, minVersion: 'TLSv1.2' }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  });
}

export interface SmtpCheck {
  ok: boolean;
  message: string;
}

/** Connects and logs in without sending anything. */
export async function verifySmtp(s: SmtpSettings): Promise<SmtpCheck> {
  try {
    const t = await makeTransport(s);
    await t.verify();
    t.close();
    return { ok: true, message: `Connected to ${s.host} on port ${s.port}${s.user ? ' and signed in' : ''}.` };
  } catch (e) {
    const err = e as { code?: string; responseCode?: number; message?: string };
    if (err.code === 'EINTERNAL') return { ok: false, message: 'That server name points at an internal address, which is not allowed.' };
    return { ok: false, message: explainSmtpError(err) };
  }
}
