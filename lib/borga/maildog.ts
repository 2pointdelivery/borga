/**
 * MailDog (https://maildog.io) as the outgoing mail server. Pure (no I/O), so the same rules serve the server's mailer, the test
 * command and the unit tests.
 *
 * A MailDog account gives a company its own email address and SMTP details: the host below, the account's user name and password,
 * and a sending domain that is DKIM and SPF verified. Mail has to be sent from an address on that domain, so the From address is
 * never invented here: it comes from MAILDOG_FROM / EMAIL_FROM, else the account's own user name (which is its address).
 */

/** Where a company creates its MailDog account and finds its email and SMTP details. */
export const MAILDOG_URL = 'https://maildog.io';
export const MAILDOG_HOST = 'mail.maildog.io';
/** 587 upgrades the connection with STARTTLS; 465 is encrypted from the first byte. */
export const MAILDOG_PORTS = [587, 465] as const;

type Env = Record<string, string | undefined>;

export interface MailTransportConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  /** The From header to use when the caller gives none. */
  from: string;
}

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;

/**
 * The deployment's MailDog settings from the environment, or null when MailDog is not set up. The password is only ever read from
 * MAILDOG_PASSWORD (never written into code or config files). MAILDOG_USER is the account user name, which is its email address.
 */
export function maildogConfig(env: Env): MailTransportConfig | null {
  const user = (env.MAILDOG_USER ?? '').trim();
  const pass = env.MAILDOG_PASSWORD ?? '';
  if (!user || !pass.trim()) return null;
  const portRaw = Number((env.MAILDOG_PORT ?? '').trim() || 587);
  const port = (MAILDOG_PORTS as readonly number[]).includes(portRaw) ? portRaw : 587;
  const fromRaw = (env.MAILDOG_FROM ?? env.EMAIL_FROM ?? '').trim();
  const from = fromRaw || (EMAIL.test(user) ? user : '');
  return { host: MAILDOG_HOST, port, secure: port === 465, user, pass, from };
}

/** What to tell a person when a send failed, without ever echoing a password. */
export function describeMailError(e: unknown): { summary: string; detail: string } {
  const err = (e ?? {}) as { code?: string; responseCode?: number; command?: string; response?: string; message?: string };
  const code = err.code ? String(err.code) : '';
  let summary: string;
  if (code === 'EAUTH' || err.responseCode === 535 || err.responseCode === 534) summary = 'The mail server refused the user name or password. Check MAILDOG_USER and MAILDOG_PASSWORD.';
  else if (err.responseCode === 550 || err.responseCode === 553 || err.responseCode === 554) summary = 'The mail server rejected the sender or recipient. The From address must be on your verified sending domain.';
  else if (code === 'ECONNREFUSED') summary = 'The mail server refused the connection. Check the host and port.';
  else if (code === 'ENOTFOUND' || code === 'EDNS') summary = 'The mail server name could not be found.';
  else if (code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'ECONNECTION') summary = 'Could not connect to the mail server. The port may be blocked from here.';
  else if (code === 'ETLS' || /tls|ssl|certificate|wrong version/i.test(err.message ?? '')) summary = 'The secure connection failed. Use port 587 (STARTTLS) or 465 (SSL).';
  else summary = 'The mail server did not accept the message.';
  const detail = [code, err.responseCode ? String(err.responseCode) : '', err.command ?? '', (err.response ?? err.message ?? '').split('\n')[0]]
    .filter(Boolean)
    .join(' · ')
    .replace(/(pass(word)?|auth)\s*[:=]\s*\S+/gi, '$1=***')
    .slice(0, 300);
  return { summary, detail };
}
