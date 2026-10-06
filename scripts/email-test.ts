import nodemailer from 'nodemailer';
import * as dotenv from 'dotenv';
import path from 'path';
import { describeMailError, maildogConfig, MAILDOG_URL } from '../lib/borga/maildog';

/**
 * Sends one email (HTML and plain text) through the mail server this deployment is set up with, so you can check the setup.
 *
 *   pnpm email:test you@yourdomain.com
 *
 * It uses MailDog when MAILDOG_USER and MAILDOG_PASSWORD are set (host mail.maildog.io, port 587 or MAILDOG_PORT), otherwise the
 * SMTP_* settings. The password is only read from the environment. Any failure is printed with the server's own words (never the
 * password) and the command exits with an error, so it can be used in a deployment check.
 */

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  const to = process.argv[2]?.trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    console.error('Usage: pnpm email:test you@yourdomain.com');
    process.exit(2);
  }
  const env = process.env;
  const md = maildogConfig(env);
  const host = env.SMTP_HOST?.trim();
  const cfg = host
    ? { host, port: Number(env.SMTP_PORT) || 587, secure: env.SMTP_SECURE === 'true' || Number(env.SMTP_PORT) === 465, user: env.SMTP_USER ?? '', pass: env.SMTP_PASS ?? '', from: env.EMAIL_FROM ?? '' }
    : md;
  if (!cfg) {
    console.error(`No mail server is configured. Set MAILDOG_USER and MAILDOG_PASSWORD (create an account at ${MAILDOG_URL}) or the SMTP_* settings in .env.`);
    process.exit(1);
  }
  if (!cfg.from) {
    console.error('No From address: set MAILDOG_FROM or EMAIL_FROM (it must be on your verified sending domain).');
    process.exit(1);
  }

  const transport = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined });
  console.log(`Sending through ${cfg.host}:${cfg.port} (${cfg.secure ? 'SSL' : 'STARTTLS'}) as ${cfg.user || 'no login'} from ${cfg.from} ...`);
  try {
    await transport.verify();
    const info = await transport.sendMail({
      from: cfg.from,
      to,
      subject: 'Borga email test',
      text: 'This is a test message from Borga.\n\nIf you can read it, outgoing email is set up correctly.\n',
      html: '<p style="font-family:system-ui,Arial,sans-serif;font-size:15px;line-height:1.5">This is a test message from <strong>Borga</strong>.</p><p style="font-family:system-ui,Arial,sans-serif;font-size:15px;line-height:1.5">If you can read it, outgoing email is set up correctly.</p>',
    });
    console.log(`Sent. Message id ${info.messageId}. Accepted: ${(info.accepted ?? []).join(', ') || 'none'}${info.rejected?.length ? `. Rejected: ${info.rejected.join(', ')}` : ''}.`);
  } catch (e) {
    const why = describeMailError(e);
    console.error(`FAILED: ${why.summary}\n  ${why.detail}`);
    process.exit(1);
  } finally {
    transport.close();
  }
}

void main();
