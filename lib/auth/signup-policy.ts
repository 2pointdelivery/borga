import { createHash, randomBytes } from 'node:crypto';

/**
 * Who may create an account and who may administer the deployment. Pure (no I/O) so it can be tested.
 *
 *   SIGNUP_MODE=open    anyone can sign up (default outside production)
 *   SIGNUP_MODE=invite  an operator-issued, single-use invite code bound to the email (default in production)
 *   SIGNUP_MODE=closed  no new accounts, except operator emails (so the owner can always bootstrap)
 *
 * Operators are listed in BORGA_OPERATOR_EMAILS (comma separated). They manage the deployment-wide API
 * keys and issue invites. Outside production with no operators listed, every user is an operator so a
 * single-user local install keeps working.
 */

type Env = Record<string, string | undefined>;

export type SignupMode = 'open' | 'invite' | 'closed';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function signupMode(env: Env): SignupMode {
  const raw = (env.SIGNUP_MODE ?? '').trim().toLowerCase();
  if (raw === 'open' || raw === 'invite' || raw === 'closed') return raw;
  return env.NODE_ENV === 'production' ? 'invite' : 'open';
}

export function operatorEmails(env: Env): string[] {
  return (env.BORGA_OPERATOR_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isOperator(email: string | null | undefined, env: Env): boolean {
  const ops = operatorEmails(env);
  if (ops.length === 0) return env.NODE_ENV !== 'production' && !!email;
  return !!email && ops.includes(email.trim().toLowerCase());
}

export interface InviteRecord {
  email: string;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
}

/** Human-pasteable single-use code. Only its hash is stored. */
export function newInviteCode(): string {
  return `inv_${randomBytes(18).toString('base64url')}`;
}

export function hashInviteCode(code: string): string {
  return createHash('sha256').update(code.trim()).digest('hex');
}

export const inviteKey = (hash: string) => `invite::${hash}`;
export const inviteUsedKey = (hash: string) => `invite_used::${hash}`;

export type InviteCheck = { ok: true } | { ok: false; error: string };

export function checkInvite(record: InviteRecord | null | undefined, email: string, now: number): InviteCheck {
  if (!record) return { ok: false, error: 'That invite code is not valid.' };
  if (record.expiresAt < now) return { ok: false, error: 'That invite code has expired. Ask for a new one.' };
  if (record.email.toLowerCase() !== email.trim().toLowerCase()) return { ok: false, error: 'That invite code was issued for a different email address.' };
  return { ok: true };
}

export type SignupDecision = { allow: true; consumeInvite: boolean } | { allow: false; status: number; error: string };

/** Decides whether this signup may proceed. The caller still validates and atomically consumes the invite. */
export function decideSignup(mode: SignupMode, email: string, hasInviteCode: boolean, env: Env): SignupDecision {
  if (isOperatorListed(email, env)) return { allow: true, consumeInvite: false };
  if (mode === 'open') return { allow: true, consumeInvite: false };
  if (mode === 'closed') return { allow: false, status: 403, error: 'Signups are closed. Ask the administrator for access.' };
  if (!hasInviteCode) return { allow: false, status: 403, error: 'Signup is by invitation. Enter the invite code you were sent.' };
  return { allow: true, consumeInvite: true };
}

// Bootstrap path: only explicitly listed operators bypass the mode (never the "no operators configured" dev default).
function isOperatorListed(email: string, env: Env): boolean {
  return operatorEmails(env).includes(email.trim().toLowerCase());
}
