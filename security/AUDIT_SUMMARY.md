# Security Audit Summary (vibe-check, 17 categories)

Date: 2026-10-10 · Target: code + http://localhost:13000 (+ production-mode header proof on :13001)

## Results

| # | Category | Status | Report |
|---|----------|--------|--------|
| 1 | SECRETS_EXPOSURE | PASS | [report](reports/SECRETS_EXPOSURE_REPORT.md) |
| 2 | DATABASE_ACCESS | PASS | [report](reports/DATABASE_ACCESS_REPORT.md) |
| 3 | AUTH_MIDDLEWARE | PASS | [report](reports/AUTH_MIDDLEWARE_REPORT.md) |
| 4 | ACCESS_CONTROL | PASS | [report](reports/ACCESS_CONTROL_REPORT.md) |
| 5 | FRONTEND_SECRETS | PASS | [report](reports/FRONTEND_SECRETS_REPORT.md) |
| 6 | SSRF | PASS | [report](reports/SSRF_REPORT.md) |
| 7 | CSRF | PASS | [report](reports/CSRF_REPORT.md) |
| 8 | SECURITY_HEADERS | PASS | [report](reports/SECURITY_HEADERS_REPORT.md) |
| 9 | CORS | PASS | [report](reports/CORS_REPORT.md) |
| 10 | RATE_LIMITING | PASS | [report](reports/RATE_LIMITING_REPORT.md) |
| 11 | SQL_INJECTION | PASS | [report](reports/SQL_INJECTION_REPORT.md) |
| 12 | XSS | PASS | [report](reports/XSS_REPORT.md) |
| 13 | PAYMENT_WEBHOOKS | PASS | [report](reports/PAYMENT_WEBHOOKS_REPORT.md) |
| 14 | FILE_UPLOADS | PASS | [report](reports/FILE_UPLOADS_REPORT.md) |
| 15 | ERROR_HANDLING | PASS | [report](reports/ERROR_HANDLING_REPORT.md) |
| 16 | PASSWORD_HASHING | PASS | [report](reports/PASSWORD_HASHING_REPORT.md) |
| 17 | DEPENDENCIES | PASS | [report](reports/DEPENDENCIES_REPORT.md) |
| — | Feature wiring | PASS | [report](reports/WIRING_REPORT.md) |

Plans: `security/plans/` (SSRF, AUTH, XSS_ERROR, HEADERS_CSP, PAYMENTS, WIRING, NOOP_CATEGORIES).

## Fixed this pass (was vulnerable → now verified)

1. **SSRF hole** in fundraising page fetch → `fetchPublic` (DNS-checked hops, no blind redirects).
2. **LLM key-steering**: workspace catalog can no longer redirect shared provider keys; only custom/Muse endpoints are customizable.
3. **Merchant Stripe webhook**: uniform 401 (oracle closed), verify-before-state, amount-vs-invoice check, refunds reopen invoices.
4. **XSS sinks**: logo/color/initials validated+escaped; CSV formula defusing everywhere.
5. **Error leaks**: app error stack dev-only; v1 tickets 500 + Stripe 502 generic.
6. **Auth depth**: in-handler session checks on browse/wigolo; MCP callback session binding; per-credential v1 throttle; per-email forgot throttle; equity stakeholder validation.
7. **CSP nonces in production** (verified: unique `nonce-` per request on every script, no `unsafe-inline`); Caddy HSTS aligned.
8. **Supply chain**: exact pins + consistent lockfile; `pnpm audit --prod` clean.
9. **Wiring**: SearchSelect pickers on quotes/POs/cap-table/leads/tickets/projects/tasks/recurring/HR; `itemId`/`managerId`/`assigneeId` models; dedupe/duplication fixes; org chart prefers ids.

## Verified mechanically

- `pnpm typecheck` clean · full unit suite **539/539** · boundary checker pass · `pnpm build` clean (91 pages).
- Prod-mode proof: nonce CSP per request, `/.env`→404, `/.git/config`→404, no `.js.map`, no CORS grant, unauthenticated 401s on v1 + new POST routes.
- Tenancy suite extended (new entities, dedicated-route refusal, v1 scoping) — code-complete, awaiting an open-signup target run (below).

## Critical issues

None remaining. All pre-existing CRITICAL/HIGH items are PASS.

## Remaining manual verification (needs you)

1. **Production URL**: you picked "Have a URL" but none came through — send it and I'll scan live headers/CORS/exposed paths (localhost equivalents all pass).
2. **Browser console**: open every core page in production, confirm zero CSP violations (revert instantly with `CSP_NONCE=off` + restart if one blocks UI).
3. **Tenancy live run**: `SIGNUP_MODE=open BORGA_OPERATOR_EMAILS=nobody@example.test BASE_URL=… node --test scripts/tenancy.test.mjs` on staging.
4. **Stripe test-mode**: pay → paid+journal; refund → reopened; underpaid → refused; replay → no duplicate journal.
5. **Funding SSRF**: try `http://169.254.169.254/` as a program URL — expect clean refusal.
6. **MIME/CSP edge**: upload a non-audio file to voice STT (expect 400-path behavior unchanged); upload PDF statement end-to-end once.
