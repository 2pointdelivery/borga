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
10. **WhatsApp Bridge SSRF & Error Sanitization**: `assertPublicUrl` + `redirect: 'manual'` enforced on `bridgeUrl` in `/api/borga/whatsapp`; raw upstream error messages replaced with safe client messages.
11. **Source Maps & Server Headers**: `productionBrowserSourceMaps: false` and `poweredByHeader: false` enforced in `next.config.ts`; `.sql`/`.dump`/`.bak` ignored in `.gitignore` and local `backups/` dump removed.
12. **Document Email & Twilio SMS Hardening**: Server-side Zod validation + escaped HTML rendering (`renderBusinessDocumentEmail`) in `/api/borga/mail` and E.164 + workspace feature-gated Twilio SMS in `/api/borga/sms`.

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

## 2026-11 security pass (uncommitted work in this tree)

Scope: server-side pricing, untrusted role/entitlement fields, row isolation,
email rate limits, ownership on mutations, and secrets in the frontend.

1. **Server-side pricing** — `lib/borga/pricing.ts` is the only money arithmetic.
   `/api/borga/data` recalculates invoices, bills and POS receipts from their
   lines on every save; `/api/borga/mail` recalculates an emailed document's
   subtotal, discount, tax and total before rendering; `/api/v1/invoices`
   derives the amount from supplied lines. Client totals are ignored; legacy
   documents without lines keep their stored amount.
   **Historical-document policy:** the persisted line inputs are the source of
   truth. A document that carries lines is repriced from them on every save
   (including a status change), so its total can only move if its own lines,
   tax rate or FX rate move; a document created before line items existed has
   no inputs to verify and keeps its recorded `amount` unchanged. Emailed and
   printed copies use the same arithmetic. The dashboard previews with the same
   `documentTotals` helpers, so the figure shown before saving equals the figure
   stored by the server.
2. **Role / entitlement** — operator rights come only from the signed session
   and `BORGA_OPERATOR_EMAILS`; billing entitlement is computed server-side.
   `lib/borga/client-privileges.ts` strips `role`, `isPro`, `isOperator`,
   `comped`, `billing`, `entitlements`, `permissions`, `admin`, `superuser`
   (and invented workspace plans) from workspace/settings saves.
3. **Row-level security** — MySQL 8 / MariaDB have no `CREATE POLICY` or
   `ENABLE ROW LEVEL SECURITY`, so isolation is enforced in the data layer:
   `lib/borga/tenant-guard.ts` parses the owner out of every tenant key
   (`u::<user>::ws::<ws>::…`, `c::<user>::<ws>::<provider>`,
   `t::<user>::<ws>::…`) and checks the workspace against that user's registry.
   It is called by every single-key read, write, delete and conditional write in
   `lib/borga/persistence.ts`; a definitive mismatch is denied and a registry
   read error fails closed. Deployment-wide keys (`api_secrets`, `borga_ping`,
   invites, admin config) have no tenant owner and are unaffected. Route-level
   ownership additionally uses `ownsWorkspaceStrict` (denies on read error) via
   `lib/borga/request-guard.ts`. Limitation: a bug that builds a key with the
   wrong owner is caught only when the workspace is not in that owner's
   registry; there is no engine-enforced policy.
4. **Rate limiting email forms** — `lib/borga/route-limits.ts` adds per-process
   buckets (429 + Retry-After): mail 30/h, test email 10/h, digest 6/h,
   notification 120/h, signup 5/h, invites 30/h. Forgot-password keeps its
   per-email throttle. Limitation: in-memory counters are per process.
5. **Ownership before update/delete** — `requireWorkspace` (session, valid ws,
   strict ownership, CSRF header for mutations) now guards mail, email,
   scheduler, agent run/queue, features, sms and autopilot. Record-level
   ownership for engagements, proposals, bookings and advisor writes is
   enforced inside `lib/borga/shared-services-server.ts`.
6. **Secrets out of the frontend** — the Composio key is a `composio` provider
   connection, encrypted at rest under `c::<user>::<ws>::composio`; the proxy
   resolves it server-side and ignores any key in the request body. The data
   GET no longer returns `composio.apiKey` or the legacy `settings.engineApiKey`;
   the dashboard store no longer persists a key; `composioKey` was removed from
   the mail client and its callers.
7. **Deleted accounts lose access at once** — session resolution used to trust a
   signed, unexpired token for its full 30-day life, so a deleted user's cookie
   kept authenticating (and could re-create workspace rows). `verifySessionToken`
   now checks the user row still exists via `lib/auth/session-guard.ts` before
   honouring the token, uncached so deletion takes effect on the next request.
   The check is inside the existing database-only branch, which fails open on
   infrastructure errors; the Edge proxy still cannot reach MySQL, so Node route
   handlers and the Node proxy path are the authoritative gate.
   The same uncached lookup also backs API keys: `verifyApiKey` passes each
   matched record through `keyOwnerAllowed` (`lib/borga/api-keys.ts`), so an
   `Authorization: Bearer borga_…` key whose owner row is gone is refused with
   the ordinary 401 instead of outliving the account, and a database error while
   checking the owner fails open for key holders too.
