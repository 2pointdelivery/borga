import 'server-only';
import { getBorgaState, setBorgaState } from './persistence';
import { applySubscription } from './billing-apply';
import { userWorkspacesKey, userWsKey, isValidUserId, isValidWsId } from './keys';
import { getUserById } from '@/lib/auth/queries';
import { isOperator } from '@/lib/auth/signup-policy';
import {
  ACCESS_TEXT, DEFAULT_LEGACY_GRACE_DAYS, EMPTY_BILLING, PRICE_CENTS_PER_USER, billableSeats, billingModeOf, evaluateAccess, monthlyCents,
  type BillingInfo, type BillingRecord,
} from './billing';
import {
  StripeError, createCheckoutSession, createCustomer, createPortalSession, createStripe, retrieveCheckoutSession, retrieveSubscription, setSeats,
  type StripeClient, type StripeEvent, type StripeSubscription,
} from './stripe';
import type { TeamInvite, Workspace } from './data';

/**
 * Billing for one workspace: a Stripe subscription at $2 per user per month, which the company pays before it is set up.
 * BILLING_MODE=enforce turns the requirement on (off by default, so a deployment without Stripe is not locked out).
 */

const recordKey = (u: string, ws: string) => `t::${u}::${ws}::billing`;
const STARTED_KEY = 't::billing::startedOn';

export class BillingUserError extends Error {}

export const billingMode = () => billingModeOf(process.env);
export const stripeConfigured = () => !!(process.env.STRIPE_SECRET_KEY ?? '').trim() && !!(process.env.STRIPE_WEBHOOK_SECRET ?? '').trim();

function stripeFor(inject?: StripeClient): StripeClient {
  if (inject) return inject;
  const key = (process.env.STRIPE_SECRET_KEY ?? '').trim();
  if (!key) throw new BillingUserError('Billing is not configured on this server yet. Ask the administrator.');
  // a stand-in server (scripts/fake-stripe.mjs) for development; never honoured in production, so no setting can send the real key elsewhere
  const base = process.env.NODE_ENV !== 'production' ? (process.env.STRIPE_BASE_URL ?? '').trim() || undefined : undefined;
  return createStripe(key, { base });
}

async function loadRecord(u: string, ws: string): Promise<BillingRecord> {
  return (await getBorgaState<BillingRecord>(recordKey(u, ws))) ?? { ...EMPTY_BILLING };
}
const saveRecord = (u: string, ws: string, r: BillingRecord) => setBorgaState(recordKey(u, ws), { ...r, updatedAt: new Date().toISOString() });

/** The day billing began for this deployment, so companies that already existed can be told apart from new ones. */
async function startedOn(): Promise<string> {
  const env = (process.env.BILLING_STARTS_ON ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(env)) return env;
  const stored = await getBorgaState<string>(STARTED_KEY);
  if (stored) return stored;
  const today = new Date().toISOString().slice(0, 10);
  await setBorgaState(STARTED_KEY, today);
  return today;
}

const graceDays = () => {
  const n = Number(process.env.BILLING_GRACE_DAYS);
  return Number.isFinite(n) && n >= 0 && n <= 365 ? Math.floor(n) : DEFAULT_LEGACY_GRACE_DAYS;
};

async function workspaceOf(u: string, ws: string): Promise<Workspace | undefined> {
  const list = (await getBorgaState<Workspace[]>(userWorkspacesKey(u))) ?? [];
  return list.find((w) => w.id === ws);
}

async function seatsFor(u: string, ws: string, ownerEmail?: string): Promise<number> {
  const invites = (await getBorgaState<TeamInvite[]>(userWsKey(u, ws, 'invites'))) ?? [];
  return billableSeats(invites.filter((i) => i.status === 'accepted').map((i) => i.email), ownerEmail);
}

export async function billingInfo(u: string, ws: string, opts: { sync?: boolean; stripe?: StripeClient } = {}): Promise<BillingInfo> {
  const mode = billingMode();
  const [record, user, workspace] = await Promise.all([loadRecord(u, ws), getUserById(u), workspaceOf(u, ws)]);
  const seats = await seatsFor(u, ws, user?.email);
  const access = mode === 'off'
    ? evaluateAccess({ mode, record, startedOn: '1970-01-01', graceDays: 0, isOperator: false, now: new Date() })
    : evaluateAccess({
      mode, record, workspaceCreatedIso: (workspace as (Workspace & { createdAtIso?: string }) | undefined)?.createdAtIso, startedOn: await startedOn(), graceDays: graceDays(),
      isOperator: !!user && isOperator(user.email, process.env), now: new Date(),
    });
  // keep the subscription's user count in step with the team
  if (opts.sync !== false && mode === 'enforce' && record.status === 'active' && record.subscriptionItemId && seats !== record.seats && (opts.stripe || stripeConfigured())) {
    try {
      await setSeats(stripeFor(opts.stripe), record.subscriptionItemId, seats);
      record.seats = seats;
      await saveRecord(u, ws, record);
    } catch { /* retried the next time the status is read */ }
  }
  return {
    mode, configured: stripeConfigured(), access: access.access, reason: access.reason, message: ACCESS_TEXT[access.reason], graceEndsOn: access.graceEndsOn,
    status: record.status, seats, billedSeats: record.seats, pricePerUserCents: PRICE_CENTS_PER_USER, monthlyCents: monthlyCents(seats),
    currentPeriodEnd: record.currentPeriodEnd, canManage: !!record.customerId,
  };
}

/** For routes that cost money or change the books: refuses a workspace that has not paid. Returns null when it may go on. */
export async function paymentRequired(u: string, ws: string): Promise<{ error: string; billing: BillingInfo } | null> {
  if (billingMode() === 'off') return null;
  const info = await billingInfo(u, ws, { sync: false });
  return info.access === 'allowed' ? null : { error: 'This workspace needs an active subscription. Open the dashboard to subscribe.', billing: info };
}

export async function startCheckout(u: string, ws: string, o: { successUrl: string; cancelUrl: string }, stripe?: StripeClient): Promise<{ url: string }> {
  if (!isValidUserId(u) || !isValidWsId(ws)) throw new BillingUserError('Invalid workspace.');
  const workspace = await workspaceOf(u, ws);
  if (!workspace) throw new BillingUserError('That company was not found.');
  const client = stripeFor(stripe);
  const user = await getUserById(u);
  const record = await loadRecord(u, ws);
  if (record.status === 'active') throw new BillingUserError('This workspace already has an active subscription.');
  const seats = await seatsFor(u, ws, user?.email);
  const customerId = record.customerId ?? (await createCustomer(client, { email: user?.email, name: workspace.legalName || workspace.name, userId: u, ws }));
  const session = await createCheckoutSession(client, { customerId, seats, userId: u, ws, workspaceName: workspace.legalName || workspace.name, successUrl: o.successUrl, cancelUrl: o.cancelUrl });
  await saveRecord(u, ws, { ...record, customerId, checkoutSessionId: session.id });
  return { url: session.url };
}

export async function startPortal(u: string, ws: string, returnUrl: string, stripe?: StripeClient): Promise<{ url: string }> {
  const record = await loadRecord(u, ws);
  if (!record.customerId) throw new BillingUserError('There is no subscription to manage yet.');
  return { url: await createPortalSession(stripeFor(stripe), record.customerId, returnUrl) };
}

/** After the user comes back from Checkout: read the session from Stripe and record the subscription it created (the webhook does the same). */
export async function refreshBilling(u: string, ws: string, stripe?: StripeClient): Promise<BillingInfo> {
  const record = await loadRecord(u, ws);
  if (record.checkoutSessionId && record.status !== 'active') {
    const client = stripeFor(stripe);
    const session = await retrieveCheckoutSession(client, record.checkoutSessionId);
    // the session must be ours: it carries our user and workspace ids
    if (session.metadata?.borga_user === u && session.metadata?.borga_ws === ws && session.subscription) {
      const sub = typeof session.subscription === 'string' ? await retrieveSubscription(client, session.subscription) : session.subscription;
      await saveRecord(u, ws, applySubscription(record, sub));
    }
  }
  return billingInfo(u, ws, { sync: false });
}

export interface WebhookOutcome {
  handled: boolean;
  detail?: string;
}

/** Applies a verified Stripe event to the workspace it names. Events about anything else are acknowledged and ignored. */
export async function applyStripeEvent(event: StripeEvent, stripe?: StripeClient): Promise<WebhookOutcome> {
  const obj = event.data.object as Record<string, any>;
  let sub: StripeSubscription | null = null;
  let meta: Record<string, string> | undefined;
  switch (event.type) {
    case 'checkout.session.completed': {
      if (obj.mode !== 'subscription' || !obj.subscription) return { handled: false, detail: 'not a subscription checkout' };
      meta = obj.metadata;
      sub = await retrieveSubscription(stripeFor(stripe), String(obj.subscription));
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      sub = obj as StripeSubscription;
      meta = sub.metadata;
      break;
    case 'invoice.payment_failed':
    case 'invoice.paid': {
      const id = typeof obj.subscription === 'string' ? obj.subscription : obj.parent?.subscription_details?.subscription;
      if (!id) return { handled: false, detail: 'invoice without a subscription' };
      sub = await retrieveSubscription(stripeFor(stripe), String(id));
      meta = sub.metadata;
      break;
    }
    default:
      return { handled: false, detail: `ignored ${event.type}` };
  }
  const u = meta?.borga_user;
  const ws = meta?.borga_ws;
  if (!u || !ws || !isValidUserId(u) || !isValidWsId(ws)) return { handled: false, detail: 'no workspace in the event' };
  if (!(await workspaceOf(u, ws))) return { handled: false, detail: 'unknown workspace' };
  const prev = await loadRecord(u, ws);
  await saveRecord(u, ws, applySubscription(prev, event.type === 'customer.subscription.deleted' ? { ...sub, status: 'canceled' } : sub));
  return { handled: true };
}

/** Operator tool: mark a workspace as not paying (a demo or a partner), or put it back. */
export async function setComped(u: string, ws: string, comped: boolean): Promise<void> {
  if (!(await workspaceOf(u, ws))) throw new BillingUserError('That company was not found.');
  const r = await loadRecord(u, ws);
  await saveRecord(u, ws, { ...r, comped });
}

export function billingUserMessage(e: unknown): { status: number; message: string } {
  if (e instanceof BillingUserError) return { status: 400, message: e.message };
  if (e instanceof StripeError) return { status: 502, message: `Stripe: ${e.message}` };
  return { status: 502, message: 'Could not reach Stripe. Try again in a moment.' };
}
