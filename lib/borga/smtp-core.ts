// A company's own outgoing mail server. Pure rules (no network), so they are tested on their own; smtp-server.ts resolves the host and sends.
//
// Letting a company point the server at any host and port would turn it into a port scanner and a way to reach internal services, so the
// rules are strict: a host name (not an address), only the ports mail servers use, an encrypted connection whenever a password is sent,
// and (checked where the host is resolved) no internal addresses.

export const SMTP_PORTS = [25, 465, 587, 2525] as const;

export interface SmtpSettings {
  host: string;
  port: number;
  /** Encrypted from the first byte (port 465). Otherwise the connection is upgraded with STARTTLS, and refused if it cannot be. */
  secure: boolean;
  user: string;
  password: string;
  fromAddress: string;
  fromName: string;
}

const HOST = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;

export type SmtpResult = { ok: true; settings: SmtpSettings } | { ok: false; error: string };

/** The values as typed (all strings) to settings the mailer can use, or what is wrong with them. */
export function parseSmtp(v: Record<string, string | undefined>): SmtpResult {
  const host = (v.host ?? '').trim().toLowerCase();
  if (!host) return { ok: false, error: 'The SMTP server name is required, for example smtp.gmail.com.' };
  if (!HOST.test(host)) return { ok: false, error: 'The SMTP server must be a host name such as smtp.example.com, not an IP address or a URL.' };
  const port = Number((v.port ?? '').trim() || 587);
  if (!Number.isInteger(port) || !(SMTP_PORTS as readonly number[]).includes(port)) return { ok: false, error: `The port must be one of ${SMTP_PORTS.join(', ')} (587 is the usual one).` };
  const secureRaw = (v.secure ?? '').trim().toLowerCase();
  const secure = secureRaw ? ['true', 'yes', 'ssl', '1'].includes(secureRaw) : port === 465;
  if (port === 465 && !secure) return { ok: false, error: 'Port 465 is always encrypted: set Encrypted to yes.' };
  const user = (v.user ?? '').trim();
  const password = v.password ?? '';
  if (user && !password) return { ok: false, error: 'A user name needs its password.' };
  const fromAddress = (v.fromAddress ?? '').trim();
  if (!EMAIL.test(fromAddress)) return { ok: false, error: 'Enter the address mail should come from, for example billing@yourcompany.com.' };
  const fromName = (v.fromName ?? '').replace(/[\r\n"<>]/g, '').trim().slice(0, 80);
  return { ok: true, settings: { host, port, secure, user, password, fromAddress, fromName } };
}

/** The From header: "Name <address>" or just the address. */
export const fromHeader = (s: Pick<SmtpSettings, 'fromAddress' | 'fromName'>): string => (s.fromName ? `${s.fromName} <${s.fromAddress}>` : s.fromAddress);

/** What a mail server's refusal usually means, in words a person can act on. */
export function explainSmtpError(e: { code?: string; responseCode?: number; message?: string }): string {
  if (e.code === 'EAUTH' || e.responseCode === 535 || e.responseCode === 534) return 'The server refused the user name or password. Gmail and Microsoft need an app password, not your normal one.';
  if (e.code === 'ECONNREFUSED') return 'The server refused the connection. Check the server name and port.';
  if (e.code === 'ENOTFOUND' || e.code === 'EDNS') return 'That server name does not exist. Check the spelling.';
  if (e.code === 'ETIMEDOUT' || e.code === 'ESOCKET' || e.code === 'ECONNECTION') return 'Could not connect. The server may block this address, or the port is wrong.';
  if (e.code === 'ETLS' || /tls|ssl|certificate|wrong version/i.test(e.message ?? '')) return 'The secure connection failed. Try port 587 with Encrypted off (STARTTLS), or port 465 with Encrypted on.';
  if (e.responseCode === 550 || e.responseCode === 553) return 'The server rejected the sender address. Use an address your mail provider lets you send from.';
  return 'The mail server did not accept the connection.';
}
