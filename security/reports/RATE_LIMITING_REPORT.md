# Rate Limiting Security Report

## Status: PASS (per-credential layer added this pass)

## Findings

Proxy per-IP buckets: auth 10/min, diag 30/min, borga+v1 120/min; right-most `X-Forwarded-For` with Caddy overwrite (spoof-proof). Per-account login lock (8 fails/15 min, correct password doesn't bypass, unknown emails counted uniformly). **Added:** per-credential throttle in `guardV1` (`lib/borga/api-throttle.ts`, 120/min per key/session user, 429 + `Retry-After`, unit-tested) and per-email throttle on `forgot` (reuses `LoginThrottle`). Payload caps: data 8 MB, webhooks 1 MB, diag 32 KB.

## What's at risk

Brute force, leaked-key abuse, reset-mail spraying, egress-cost attacks (`invoice-pay`→Stripe, `comps`→SEC fan-out).

## What's already secure

All of the above post-fix; in-memory stores documented as approximate under horizontal scale.

## Recommendations

1. If scaling out: shared counter store (Redis/DB) or documented approximate limiting.
2. Watch 429 rates per key as an abuse signal.
