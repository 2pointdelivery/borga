// What a workspace costs and whether it may be used: $2 per user per month, paid before the company is set up. Pure rules (no I/O), so
// they are tested on their own; billing-server.ts applies them and talks to Stripe.
//
// Users. A workspace belongs to the account that created it; the people it has accepted into the team (Team Invites with status
// "accepted") are its other users. The bill is one seat per distinct person, never fewer than one.

export const PRICE_CENTS_PER_USER = 200;
export const BILLING_CURRENCY = 'usd';
/** A payment that failed keeps working for this long (Stripe retries the card meanwhile), then the workspace is held. */
export const PAST_DUE_GRACE_DAYS = 7;
/** Companies that existed before billing was switched on get this long to subscribe. */
export const DEFAULT_LEGACY_GRACE_DAYS = 14;
export const MAX_SEATS = 500;

export type SubscriptionStatus = 'none' | 'incomplete' | 'active' | 'past_due' | 'canceled' | 'unpaid';

export interface BillingRecord {
  customerId?: string;
  subscriptionId?: string;
  subscriptionItemId?: string;
  status: SubscriptionStatus;
  /** The number of users the subscription is currently charged for. */
  seats: number;
  currentPeriodEnd?: string;
  /** When the first failed payment happened, to count the grace days from. */
  pastDueSince?: string;
  /** Set by the deployment operator for a workspace that does not pay (a demo, a partner). */
  comped?: boolean;
  checkoutSessionId?: string;
  updatedAt: string;
}

export const EMPTY_BILLING: BillingRecord = { status: 'none', seats: 0, updatedAt: '' };

export type BillingMode = 'off' | 'enforce';

export function billingModeOf(env: Record<string, string | undefined>): BillingMode {
  return (env.BILLING_MODE ?? '').trim().toLowerCase() === 'enforce' ? 'enforce' : 'off';
}

/** One seat for the owner plus one per distinct accepted team member, at most MAX_SEATS. */
export function billableSeats(acceptedEmails: string[], ownerEmail?: string): number {
  const owner = (ownerEmail ?? '').trim().toLowerCase();
  const others = new Set(acceptedEmails.map((e) => e.trim().toLowerCase()).filter((e) => e && e !== owner));
  return Math.min(MAX_SEATS, 1 + others.size);
}

export const monthlyCents = (seats: number): number => Math.max(1, Math.floor(seats)) * PRICE_CENTS_PER_USER;

export const formatUsd = (cents: number): string => `$${(cents / 100).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type AccessReason =
  | 'billing-off' | 'operator' | 'comped' | 'paid' | 'past-due' | 'past-due-expired' | 'legacy-grace' | 'unpaid' | 'canceled';

export interface AccessInput {
  mode: BillingMode;
  record: BillingRecord;
  /** When the workspace was created (ISO). Missing means it predates billing. */
  workspaceCreatedIso?: string;
  /** The date billing was switched on (YYYY-MM-DD). */
  startedOn: string;
  graceDays: number;
  isOperator: boolean;
  now: Date;
}

export interface AccessResult {
  access: 'allowed' | 'blocked';
  reason: AccessReason;
  /** For a grace period: the last day it is allowed. */
  graceEndsOn?: string;
}

const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function evaluateAccess(i: AccessInput): AccessResult {
  if (i.mode === 'off') return { access: 'allowed', reason: 'billing-off' };
  if (i.isOperator) return { access: 'allowed', reason: 'operator' };
  const r = i.record;
  if (r.comped) return { access: 'allowed', reason: 'comped' };
  if (r.status === 'active') return { access: 'allowed', reason: 'paid' };
  const now = i.now.getTime();
  if (r.status === 'past_due') {
    const since = Date.parse(r.pastDueSince ?? r.updatedAt) || now;
    const until = since + PAST_DUE_GRACE_DAYS * DAY;
    return now < until ? { access: 'allowed', reason: 'past-due', graceEndsOn: isoDay(until) } : { access: 'blocked', reason: 'past-due-expired' };
  }
  // not subscribed: a company that was here before billing started has a few weeks to subscribe, a new one pays first
  const created = i.workspaceCreatedIso ? Date.parse(i.workspaceCreatedIso) : Number.NaN;
  const legacy = Number.isNaN(created) || created < Date.parse(`${i.startedOn}T00:00:00Z`);
  if (legacy) {
    const until = Date.parse(`${i.startedOn}T00:00:00Z`) + i.graceDays * DAY;
    if (now < until) return { access: 'allowed', reason: 'legacy-grace', graceEndsOn: isoDay(until - DAY) };
  }
  return { access: 'blocked', reason: r.status === 'canceled' ? 'canceled' : 'unpaid' };
}

export const ACCESS_TEXT: Record<AccessReason, string> = {
  'billing-off': 'Billing is not switched on.',
  operator: 'Deployment administrator: no charge.',
  comped: 'This workspace is on the house.',
  paid: 'Subscription active.',
  'past-due': 'The last payment failed. Update the card to keep the workspace open.',
  'past-due-expired': 'The last payment failed and was not fixed in time.',
  'legacy-grace': 'This company needs a subscription.',
  unpaid: 'This workspace needs a subscription before it can be set up.',
  canceled: 'The subscription was cancelled.',
};

export interface BillingInfo {
  mode: 'off' | 'enforce';
  /** False when billing is on but Stripe keys are missing: nobody can pay, so the screen says so. */
  configured: boolean;
  access: 'allowed' | 'blocked';
  reason: AccessReason;
  message: string;
  graceEndsOn?: string;
  status: SubscriptionStatus;
  seats: number;
  billedSeats: number;
  pricePerUserCents: number;
  monthlyCents: number;
  currentPeriodEnd?: string;
  canManage: boolean;
}

