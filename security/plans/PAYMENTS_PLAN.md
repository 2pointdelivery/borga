# Payment Webhooks Fix Plan — implemented

## Changes

- `app/api/borga/hooks/stripe/route.ts` — uniform 401 on all failures (no oracle); verify-before-state-change; paid amount ≥ invoice total enforced; `charge.refunded`/`dispute.created` reopen the invoice; `paidAt`/`paidMethod` recorded.

## New files

- None.

## Verification goals

- [x] `pnpm typecheck`; billing tests pass.
- [ ] Manual: HUMAN — Stripe test-mode end-to-end: pay (invoice → paid + journal), refund (invoice → sent), underpaid session (refused, logged), replayed event (no duplicate journal), bad signature (401, same shape as unknown workspace).

## Manual verification (for the human)

- Confirm no duplicate `invoice:<id>:paid` journals after CLI `stripe events resend`.
