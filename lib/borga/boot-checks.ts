/**
 * Production startup checks for required secrets. Pure (no I/O, no server-only import) so it
 * can be unit tested and called from instrumentation.ts.
 *
 * In production the server refuses to start when a secret is missing, too short or still a
 * placeholder, instead of silently falling back to a guessable default.
 */

export interface BootReport {
  errors: string[];
  warnings: string[];
}

type Env = Record<string, string | undefined>;

const PLACEHOLDER = /change[-_ ]?me|changeme|example|placeholder|ci-only|not-a-secret|your[-_ ]|dev-insecure|^x+$|^0+$/i;

function weak(value: string): boolean {
  return PLACEHOLDER.test(value);
}

export function checkBootEnv(env: Env): BootReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const get = (k: string) => (env[k] ?? '').trim();

  if (!get('DATABASE_URL')) errors.push('DATABASE_URL is not set.');

  const session = get('SESSION_SECRET');
  if (!session) errors.push('SESSION_SECRET is not set (generate: openssl rand -hex 32).');
  else if (session.length < 32) errors.push('SESSION_SECRET must be at least 32 characters.');
  else if (weak(session)) errors.push('SESSION_SECRET looks like a placeholder; generate a real one.');

  const key = get('BORGA_SECRET_KEY');
  if (!key) errors.push('BORGA_SECRET_KEY is not set: stored credentials would be encrypted with a key derived from DATABASE_URL (generate: openssl rand -hex 32).');
  else if (!/^[0-9a-f]{64}$/i.test(key)) errors.push('BORGA_SECRET_KEY must be exactly 64 hex characters (openssl rand -hex 32).');
  else if (/^(.)\1+$/.test(key)) errors.push('BORGA_SECRET_KEY looks like a placeholder; generate a real one.');

  if (session && key && session === key) errors.push('SESSION_SECRET and BORGA_SECRET_KEY must be different values.');

  const ops = get('BORGA_OPERATOR_EMAILS');
  if (!ops) errors.push('BORGA_OPERATOR_EMAILS is not set: nobody could change the shared API keys or issue signup invites (comma-separated admin emails).');
  else if (!ops.split(',').every((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim()))) errors.push('BORGA_OPERATOR_EMAILS must be a comma-separated list of valid email addresses.');
  if (get('SIGNUP_MODE') && !['open', 'invite', 'closed'].includes(get('SIGNUP_MODE').toLowerCase())) errors.push('SIGNUP_MODE must be open, invite or closed.');
  if (get('SIGNUP_MODE').toLowerCase() === 'open') warnings.push('SIGNUP_MODE=open: anyone who finds the site can create an account and spend the shared API keys.');

  const cron = get('CRON_SECRET');
  if (!cron) warnings.push('CRON_SECRET is not set: /api/borga/cron answers 401, so heartbeats, SLA sweeps, mail polling and sync jobs never run.');
  else if (cron.length < 24 || weak(cron)) errors.push('CRON_SECRET is too short (24+ characters) or a placeholder.');

  if (!get('SMTP_HOST')) warnings.push('SMTP_HOST is not set: password reset, ticket replies and email updates cannot be delivered.');
  if (!get('APP_URL')) warnings.push('APP_URL is not set: links in emails will be missing.');
  if (get('BORGA_ADMIN_TOKEN') && weak(get('BORGA_ADMIN_TOKEN'))) errors.push('BORGA_ADMIN_TOKEN looks like a placeholder.');

  return { errors, warnings };
}
