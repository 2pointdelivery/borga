# Error Handling Security Report

## Status: PASS (2 leaks closed this pass)

## Findings

**Fixed:** `app/app/error.tsx` rendered `error.stack` (paths, versions) to any user — now development-only; message stays. **Fixed:** `POST /api/v1/tickets` returned raw `e.message` on 500 (DB/driver detail to API consumers) — now generic + server log; matches the sibling-route pattern. **Fixed:** `invoice-pay` 502 returned raw Stripe messages — now generic + server log. Other 4xx handlers echo only our own validation strings (safe). `/api/diag` intentionally unauthenticated but bounded (32 KB cap, 4000-char slice, log-only, always `{ok:true}`). No framework debug/docs endpoints (no GraphQL/Swagger/Actuator surface).

## What's at risk

Stack-trace disclosure, driver-error oracle, upstream reason-code leakage.

## What's already secure

Global handlers, generic 500s (12 routes audited), bounded diag sink.

## Recommendations

1. Keep the rule: 5xx = static string + `console.error`; 4xx = our strings only, never upstream bodies.
