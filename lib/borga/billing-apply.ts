// Turning what Stripe says about a subscription into the workspace's billing record. Pure, so it is tested on its own.

import type { BillingRecord, SubscriptionStatus } from './billing';
import type { StripeSubscription } from './stripe';

const STATUS: Record<string, SubscriptionStatus> = {
  active: 'active', trialing: 'active', past_due: 'past_due', canceled: 'canceled', unpaid: 'unpaid', incomplete: 'incomplete', incomplete_expired: 'canceled', paused: 'unpaid',
};

/** The new billing record after learning what Stripe says about the subscription. */
export function applySubscription(prev: BillingRecord, sub: StripeSubscription, now = new Date()): BillingRecord {
  const status = STATUS[sub.status] ?? 'unpaid';
  const item = sub.items?.data?.[0];
  const end = sub.current_period_end ?? item?.current_period_end;
  return {
    ...prev,
    status,
    subscriptionId: sub.id,
    subscriptionItemId: item?.id ?? prev.subscriptionItemId,
    seats: item?.quantity ?? prev.seats,
    customerId: (typeof sub.customer === 'string' ? sub.customer : sub.customer?.id) ?? prev.customerId,
    currentPeriodEnd: end ? new Date(end * 1000).toISOString() : prev.currentPeriodEnd,
    pastDueSince: status === 'past_due' ? prev.pastDueSince ?? now.toISOString() : undefined,
  };
}
