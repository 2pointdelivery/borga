# Security Headers Security Report

## Status: PASS (CSP nonces shipped this pass; browser-console check remains for the human)

## Findings

**Fixed:** `script-src 'unsafe-inline'` is gone from production. `proxy.ts` now mints a per-request nonce, passes `x-nonce` to Next.js (which applies it to framework + `<Script>` output), and serves a full nonce CSP on every proxied page; `AnalyticsGate` threads the nonce explicitly. `next.config.ts` keeps the static policy minus `script-src` (two policies intersect — a static script-src would re-allow what the nonce forbids). Escape hatch: `CSP_NONCE=off`. Matcher extended to all HTML pages (`/login`, `/signup`, `/forgot`, `/reset`, `/developers`); new top-level pages must add matcher entries. HSTS `max-age=31536000; includeSubDomains` in app + proxy + Caddy (aligned this pass); XFO DENY, nosniff, strict Referrer-Policy, Permissions-Policy, COOP same-origin everywhere.

## What's at risk

XSS payload execution, clickjacking. Nonce CSP + DENY framing contain both.

## What's already secure

All five headers + COOP globally; `style-src 'unsafe-inline'` retained (required, acceptable).

## Recommendations

1. HUMAN: open every core page with devtools console visible — zero CSP violations expected; report any and revert via `CSP_NONCE=off` if one blocks real UI.
2. Add `report-uri` endpoint later for violation telemetry.
