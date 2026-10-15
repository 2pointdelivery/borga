# Payment Webhooks Security Report

## Status: PASS (merchant route hardened this pass)

## Findings

Platform route: HMAC-SHA256 verify before parse/apply, 5-min anti-replay, 1 MB cap, re-retrieves subscriptions from Stripe (never trusts payload), deleted→canceled, unknown types ignored. **Fixed in merchant route** (`app/api/borga/hooks/stripe/route.ts`): uniform 401 on every failure (was 404/401 oracle about Stripe linkage); signature verified before any state change; paid amount compared to the invoice total (underpaid sessions refused + logged); `charge.refunded`/`dispute.created` reopen the invoice (was: stayed paid forever); journal guarded by `externalRef` idempotency key. `payment_failed` correctly leaves the invoice `sent`.

## What's at risk

Forged "paid" callbacks, underpayment marked paid, refunds never reconciled.

## What's already secure

Signature verification both routes, idempotent journal posting, tenant binding via signed metadata + key scan.

## Recommendations

1. Consider event-id dedup table if concurrent delivery interleaving ever observed (replays are value-idempotent today).
