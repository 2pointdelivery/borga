# Maturity review (2026-09-30)

Legend: **P0** fix before exposing to real users, **P1** fix before relying on it, **P2** polish.

## Fixed in this pass
- `SESSION_SECRET` fell back to a public hardcoded string, so session cookies were forgeable if the variable was unset. Production now refuses to run without a 16+ char secret (`lib/auth/session.ts`).
- SMTP transport was cached for the process lifetime, so changing SMTP settings in the dashboard had no effect until restart. It is now rebuilt when the config changes (`lib/auth/mailer.ts`).
- `getBorgaStatesByPrefix` treated `_` in ids as a LIKE wildcard (possible cross-tenant prefix match). Wildcards are now escaped.
- `Dockerfile` copied `.env` (all secrets) into the image. Removed, runs as non-root, has a healthcheck; `.dockerignore` excludes env files.
- `.env.example` and README said Postgres; the code is MySQL (`mysql2`). Corrected.
- The pre-existing failing test (`check-server-boundaries`) now passes. The checker is non-strict by default, so the test runs it with `--strict`.
- Added CI (`.github/workflows/ci.yml`: typecheck, lint, test, build), feature flags, and the Support Desk.

## P0: needs attention
1. **Apply migration `drizzle/0001_*.sql` with care.** It makes `borga_users.email` unique (the old index allowed duplicate accounts under a signup race). It also adds `reset_token` / `reset_token_expires`, which your live DB probably already has, so edit those two lines out if `db:migrate` reports duplicate columns. Check for duplicate emails first.
2. **Secrets are partly global.** Integration credentials (Twilio, Meta, Google Ads, LinkedIn, ChatGPT Ads) are now per user + workspace and encrypted (`Connections` tab). SMTP, LLM and the older Twilio keys in `/api/borga/config` are still one shared row that any signed-in user can overwrite; fine single-tenant, scope them before multi-tenant use. Phase 4 migrates calls to the per-workspace Twilio connection.
3. ~~Inbound/outbound business-event webhooks were unreachable and cross-tenant~~ **Fixed 2026-10-01.** Inbound now authenticates with a per-workspace bearer token or webhook HMAC and uses user-scoped keys; dispatch is user-scoped, signs headers correctly (it previously sent `sha256=[object Promise]`), blocks private/internal targets by resolving DNS, and retries from cron. Neither could ever have worked before: the UI omitted the required CSRF header.
4. **Uncommitted work.** ~130 changed/untracked files (Electron shell, agent core, heartbeat, cron, revenue tracker, this work) are not in git. Review and commit; one disk failure loses them.

## P1
5. **Last-write-wins persistence.** The browser writes whole entity arrays (`/api/borga/data`, 500 KB cap per entity). Two tabs/devices, or a server-side writer (heartbeat notices, agent runs), silently overwrite each other. Tickets avoid this (server-authoritative, one row per ticket); other entities do not. Path forward: per-record rows or versioned writes.
6. **Persistence hides failures. PARTLY FIXED (2026-10-01, T20):** the dashboard load and save route (`/api/borga/data`) now return 503 on a database error, and the client holds server writes after a failed load. Still open: single-key readers such as `getBorgaState` and the server-side agent/cron paths still treat a database error as "no data". Original finding: `getBorgaState` returns `null` on DB errors and the data route falls back to seed data, so an outage can look like "fresh install" and the next autosave may overwrite real data with seeds. Fail loudly (503) instead.
7. **Cron enumerates by loading every row** (`listScheduledWorkspaces` -> `getAllBorgaStates`). Use `listBorgaKeys` (added) instead.
8. **In-memory rate limiter** resets per instance and trusts `x-forwarded-for`. Use a shared store or the host's limiter; only trust the header behind your own proxy.
9. **Mail paths tested only against local fake servers.** IMAP polling and SMTP replies pass end to end against a local IMAP server and SMTP sink. Smoke-test once with your real provider (TLS and app-password quirks).
10. **Backups and migrations.** No backup story, and `borga_state` is one JSON key-value table, so there is no referential integrity or reporting. Acceptable now; plan real tables for tickets/finance before scale.
11. **Test coverage is thin.** 23 tests cover request helpers, the boundary checker, SLA/threading helpers and flags. There are no route, auth or store tests.

## P2
12. **Fake or simulated surfaces** still ship: sidebar "Fleet online - brain linked" is static text; Calls progress is simulated without Twilio; Social "publish" does not post; Valuation price history and radar are illustrative. They are labelled in the Features list (`simulated` / `experimental`); turn them off with the flags until real.
13. **Dead code in `ToolsTab.tsx`** (`beginConnect`, `checkConnectionStatus`, `refreshToken` unused) and 26 lint warnings (hook dependency arrays, unused vars). The 70 KB file should be split.
14. **Monoliths:** `lib/borga/data.ts` (172 KB, types + seeds + logic) and `store.ts` (112 KB). Split types / seeds / selectors.
15. **Wake greeting speaks on every page load** (`DashboardShell`). Make it opt-in.
16. `FinancePage` renders a **Tax** tab that is missing from `nav.ts` (command palette cannot deep-link to it).
17. CSP still allows `'unsafe-inline'` scripts in production; move to nonces.
18. `dist-desktop/` holds a 540 MB installer and `.next` ~1.2 GB locally (both git-ignored); delete when not needed.

## Cleanup done
Removed: about 45 unused `components/ui/*` primitives and ~30 npm dependencies they pulled in, `postgres`, `wait-on`, `wrangler`, `@opennextjs/cloudflare`, `@cloudflare/workers-types`, `archiver`; Cloudflare configs (`wrangler.toml`, `open-next.config.ts`; the app cannot run on Workers); `.gitlab-ci.yml` (template sync/S3 plumbing); `scripts/make-zip.mjs` + its `postbuild` hook, the public `borga-product.zip` and the Settings "Product files" card (it published the source from `/public`); one-off scripts `check-chars.cjs`, `remove-demo-data.ts`, `scripts/win/cleanup-dist.bat`; unused `hooks/`, `utils/`, `lib/logger.ts`, `lib/api-error-response.ts`; stale `docs/AI_GUIDE.md`; serve*/build logs; `public/next.svg`; `landing-site/.next` and `out`.
Recoverable from git history if any of it was wanted.

## AI settings reconciled (2026-10-01)
One place now controls the model: **Integrations → AI & Voice**. Keys, the default provider/model, a real Test button (measured latency) and the advanced model catalog all live there. Command Center shows a read-only summary with a link; Settings only keeps the agent voice. Removed: the cosmetic Activate/Disconnect "connections", the hardcoded 120 ms badge, the unused "LLM provider" text field, dead ElevenLabs fields (`outboundNumber`, `autoCallOnApprove`, `apiMode`), the duplicate CRM URL field, and a false "Cloudflare Workers / HSTS" status tile. Fixed: per-agent models only worked with provider-prefixed ids (now resolved through the catalog); dashboard-saved custom/Ollama base URLs were ignored (env was read at import time); placeholder `.env` values ("example", "xxx") shadowed dashboard keys; every LLM call and agent run loaded the whole database. Remaining: provider base URLs from the catalog are fetched server-side (fine single-tenant; add an allowlist before multi-tenant).

## Supermemory (2026-10-01)
Optional, off by default: agent memory, knowledge-base retrieval, company profile and similar-ticket lookup (docs/SUPERMEMORY.md). Verified against a local fake of the documented API; **run `scripts/smoke-supermemory.mjs` once with a real key.** Also fixed while wiring it: the ticket tools (`list_tickets`, `create_ticket`, `update_ticket`, `draft_ticket_reply`) were registered but never described in the agent prompt, so agents did not know they existed.

## Engine, recurring bills, revenue tracker (2026-10-01)
- **Company Engine** (was "2Point Engine"): per-company encrypted connection, safe paginated CRM pull into customers/deals (docs/COMPANY_ENGINE.md). Fixed: the orchestrate route looked up a company's endpoint under an un-prefixed key the dashboard never writes (so a company's own endpoint was never used), fetched user-supplied URLs with no SSRF guard, and the engine key sat in plaintext in client-visible settings. Still sample data: the Operations dashboard (bookings/fleet/drivers) seeded from `INITIAL_OPS`.
- **Recurring bills** (Finance → Recurring Bills): same tested schedule engine as recurring invoices; bills are recorded **unpaid**, never paid automatically; "variable amount" flags each bill as an estimate. Like invoices, generation runs when the dashboard is open (client-side); nothing is generated while nobody has Borga open.
- **Revenue Tracker** now follows the company's services (captured at onboarding, editable on the tracker, recovered from the old knowledge-base sentence for earlier companies). The seeded "2Point Logistics" plan (shown to every company) was removed. Companies that already saved a tracker keep it; delete it and create one from services. Ledger actuals are matched to a service by category or by naming it in the description, only into empty months.

## Email updates (2026-10-01)
Per-workspace transactional emails and digest (docs/EMAIL_UPDATES.md). Tested against a local SMTP sink only. Known gaps: one shared SMTP sender, no bounce handling, browser-raised events need the dashboard open.
