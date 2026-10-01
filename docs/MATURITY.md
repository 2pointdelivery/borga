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
1. **Migration `0001` (unique email) is now safe to apply. DONE 2026-10-01 (T22).** See the update at the end of this file. Still to do: run it on the development database (`pnpm db:migrate`; `--dry-run` shows it as the one pending migration) and on production (automatic).
2. **Secrets are partly global.** Integration credentials (Twilio, Meta, Google Ads, LinkedIn, ChatGPT Ads) are now per user + workspace and encrypted (`Connections` tab). SMTP, LLM and the older Twilio keys in `/api/borga/config` are still one shared row that any signed-in user can overwrite; fine single-tenant, scope them before multi-tenant use. Phase 4 migrates calls to the per-workspace Twilio connection.
3. ~~Inbound/outbound business-event webhooks were unreachable and cross-tenant~~ **Fixed 2026-10-01.** Inbound now authenticates with a per-workspace bearer token or webhook HMAC and uses user-scoped keys; dispatch is user-scoped, signs headers correctly (it previously sent `sha256=[object Promise]`), blocks private/internal targets by resolving DNS, and retries from cron. Neither could ever have worked before: the UI omitted the required CSRF header.
4. **Uncommitted work.** ~130 changed/untracked files (Electron shell, agent core, heartbeat, cron, revenue tracker, this work) are not in git. Review and commit; one disk failure loses them.

## P1
5. **Last-write-wins persistence. PARTLY FIXED 2026-10-01 (T21).** A save from a stale copy is now refused (409) and the user sees a banner, so one tab, device or agent can no longer silently overwrite another. Not fixed: see the update at the end of this file for what the protection does and does not cover.
6. **Persistence hides failures. PARTLY FIXED (2026-10-01, T20):** the dashboard load and save route (`/api/borga/data`) now return 503 on a database error, and the client holds server writes after a failed load. Still open: single-key readers such as `getBorgaState` and the server-side agent/cron paths still treat a database error as "no data". Original finding: `getBorgaState` returns `null` on DB errors and the data route falls back to seed data, so an outage can look like "fresh install" and the next autosave may overwrite real data with seeds. Fail loudly (503) instead.
7. **Cron enumerates by loading every row** (`listScheduledWorkspaces` -> `getAllBorgaStates`). Use `listBorgaKeys` (added) instead.
8. **In-memory rate limiter** resets per instance and trusts `x-forwarded-for`. Use a shared store or the host's limiter; only trust the header behind your own proxy.
9. **Mail paths tested only against local fake servers.** IMAP polling and SMTP replies pass end to end against a local IMAP server and SMTP sink. Smoke-test once with your real provider (TLS and app-password quirks).
10. **Backups and migrations.** No backup story, and `borga_state` is one JSON key-value table, so there is no referential integrity or reporting. Acceptable now; plan real tables for tickets/finance before scale.
11. **Test coverage is thin.** 23 tests cover request helpers, the boundary checker, SLA/threading helpers and flags. There are no route, auth or store tests.

## P2
12. **Fake or simulated surfaces. MOSTLY FIXED 2026-10-01 (T30, T31).** Simulated and experimental features now ship off (Calls, Social, Advertising, Valuation, Fundraising, WhatsApp), the static "Fleet online" text is a real status line, and a new company is seeded with no invented data. See the update at the end of this file. Still true when a feature is switched on: Calls are simulated without Twilio, Social "publish" does not post, Valuation price history and radar are illustrative.
13. **Dead code in `ToolsTab.tsx`** (`beginConnect`, `checkConnectionStatus`, `refreshToken` unused) and 26 lint warnings (hook dependency arrays, unused vars). The 70 KB file should be split.
14. **Monoliths:** `lib/borga/data.ts` (172 KB, types + seeds + logic) and `store.ts` (112 KB). Split types / seeds / selectors.
15. **Wake greeting and always-listening microphone. FIXED 2026-10-01 (T33).** Voice is opt-in (Settings); nothing plays and no microphone is requested on a fresh install.
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

## Update 2026-10-01: boot-time secret checks (T14)

In production the server now refuses to start (exit code 1, message lists every problem) unless `DATABASE_URL`, `SESSION_SECRET` (32+ chars, not a placeholder) and `BORGA_SECRET_KEY` (64 hex chars, different from the session secret) are set. A weak or placeholder `CRON_SECRET` also blocks startup; a missing one, `SMTP_HOST` or `APP_URL` only warns. The encryption, password-reset and unsubscribe-token code paths also throw in production instead of using a built-in fallback. `next build` is unaffected. Checks live in `lib/borga/boot-checks.ts` (tested in `lib/boot.test.ts`) and run from `instrumentation.ts`.

## Update 2026-10-01: tenancy, signup and shared keys (T10, T11)

Launch model is one organisation with invite-only signup (`SIGNUP_MODE=invite`, default in production). Shared API keys can only be changed by operators (`BORGA_OPERATOR_EMAILS`, required in production). See docs/ROUTE_AUDIT.md. Still true: shared keys are deployment-wide, so this is not a multi-tenant SaaS until keys are per workspace.

## Update 2026-10-01: save size limit (T25)

The per-entity save cap is now 8 MB (it was 500 KB, which a growing company's journals or bank transactions would have hit, with writes silently refused). Bodies are refused by `Content-Length` before being read, and the size is measured in bytes. 8 MB is well under the MySQL JSON limit (`max_allowed_packet`, 64 MB default on 8.4). A save over the cap now shows a clear message and keeps the data on the device. Verified: 1 MB and 7.9 MB save, 8.5 MB and a multibyte 9 MB body return 413. Remaining risk is unchanged: each save sends the whole list (bandwidth) and last-write-wins applies; per-record rows are the real fix.

## Update 2026-10-01: free LLM providers and live model loading

FreeLLM.net is a directory of providers that hand out free API keys; it has no API of its own, so it is linked from the UI, not called. Integrations, AI and Voice now has a "Free LLMs" panel: Groq, Google Gemini, OpenRouter, NVIDIA NIM and the new Cerebras, SambaNova and Mistral presets, each with a signup link, key status and a "Load free models" button, plus "Load all free models". The loader (`/api/borga/llm-models`) reads each provider's live `/models` list with the key saved for it, keeps chat models only (no embeddings, speech or safety models), classifies free vs credits vs paid, and merges the result into the workspace catalog (stale free models are replaced; paid, hand-added and the currently selected model are kept). Pure logic in `lib/borga/model-catalog.ts`, 12 tests in `lib/models.test.ts`.

Also fixed: Gemini chat used `/v1beta/chat/completions`, which does not exist; Google's OpenAI-compatible path is `/v1beta/openai`. New and saved catalogs are corrected.

Verified live: OpenRouter (public list, no key): 20 free of 463 models loaded in the browser, persisted across reload. Verified: error, authorization and unsupported-provider paths. **Not verified against real keys:** Groq, Gemini, NVIDIA, Cerebras, SambaNova and Mistral (response shapes follow their documented OpenAI-compatible `/models` formats; base URLs for Cerebras, SambaNova and Mistral are from their public docs). The Gemini URL change is also unverified live. "Free" for these providers means every chat model the provider lists for the key, subject to its own rate limits and plan rules, which can change.

## Update 2026-10-01: deployment review (T50, T51)

**Docker has never been run on this project.** Docker is not installed on the development machine, so `docker compose` and `docker build` were not executed. What was done instead: every deploy file was reviewed against what the app now requires, and the runner stage was simulated without Docker (fresh build with no `.env`; a separate directory holding only what the image copies, with production-only dependencies and no `next.config.ts`; started with environment variables only). Verified in that simulation: starts and serves, `/api/health` reports the database connected, refuses to start without secrets (exit code 1), security headers present, scheduler endpoint works with its secret. **Not verified:** the image build itself, running as the unprivileged `node` user, MySQL initialisation from `init.sql`, Caddy and certificate issuance, the systemd timers, backup and restore, and anything on arm64 (Oracle Ampere A1). Treat the first run on the VM as the real test and follow the checklist in deploy/README.md.

Found and fixed during the review:
- **The scheduler was blocked by the proxy.** `proxy.ts` required a session cookie for `/api/borga/cron`, so a systemd timer (which sends only `Authorization: Bearer $CRON_SECRET`) was rejected with 401. Heartbeats, SLA sweeps, mailbox polling, sync jobs and email digests would never have run in production. The route already authenticates with `CRON_SECRET`, so the proxy now lets it through (verified: no or wrong secret gives 401; the right one runs all 7 local workspaces). The secret comparison is now constant time. `lib/proxy.test.ts` (7 tests) covers the proxy's whole access policy and fails on the old behaviour.
- The container ran `pnpm start` as the `node` user although pnpm was installed by corepack as root, which can fail offline at runtime. It now runs `next` directly.
- No clickjacking protection: the CSP now has `frame-ancestors 'none'` and `form-action 'self'`; Caddy adds HSTS.
- Container logs are capped (10 MB x 3) so they cannot fill the free-tier disk.
- `deploy/update.sh` now fails if `/api/health` does not answer after the restart, instead of reporting success.

Still open: backups live on the same VM disk (copy them off the VM); there is no automatic rollback in `update.sh`; the Docker image is not scanned or pinned to digests.

## Update 2026-10-01: cross-tenant test suite (T12)

`pnpm test:tenancy` (9 tests, live server and database) proves one user cannot read or change another's data through any workspace-scoped route, and found three real defects (WhatsApp keyspace and operator bypass, un-prefixed fallbacks in memory and scheduler), now fixed. See docs/ROUTE_AUDIT.md. Not in CI yet. Isolation relies on the user id coming from the signed cookie; the `u` and `ws` query parameters on the public webhook and inbound-mail endpoints are authenticated by a per-workspace token or provider signature (tested).

## Update 2026-10-01: database migrations (T22)

**What was wrong.** `drizzle/0001` re-added the `reset_token` columns that the development database already had, so it would have run `DROP INDEX`, then failed on "Duplicate column name", leaving `borga_users` with no email index at all (MySQL DDL cannot be rolled back). It would also have failed halfway on duplicate emails. A second, separate schema in `deploy/init.sql` could have drifted from the migrations.

**What changed.**
- `0001` is idempotent: each change checks `information_schema` first, and the index swap is a single atomic `ALTER`, so a failure leaves the old index in place.
- `scripts/migrate.mjs` (`pnpm db:migrate`, `--dry-run`) applies pending migrations using drizzle's own history table. It takes a MySQL named lock (two runs at once are safe), refuses to start if duplicate emails exist (listing them; nothing is changed), refuses to replay migrations over tables it did not create, names the exact statement on failure, and verifies the final schema.
- Docker: a one-shot `migrate` service runs before the app and the app starts only if it succeeded. `init.sql` is gone, so the files in `drizzle/` are the single source of truth. `deploy/migrate.sh` runs it by hand.

**Verified** against local MySQL 8.4 (the production image's version) with `pnpm test:migrate` (8 scenarios, each in a throwaway database): fresh database and an immediate second run; a database with only `0000`; the exact state of the real development database (0000 recorded, reset columns added by hand, plain index, 21 users: no rows lost, index becomes unique); duplicate emails refused with nothing changed, then fixed and re-run; the database rejects `WHO@Example.TEST` after `who@example.test`; `--dry-run`; two simultaneous runs; and tables not created by the migrations. With the original `0001` restored, the development-database scenario fails with "Duplicate column name 'reset_token'". The script also ran from a directory laid out like the image (`scripts/` and `drizzle/` only). The compose file parses as YAML with the intended dependency order. 5 unit tests for the pure helpers run in `pnpm test`.

**Not verified:** the Docker image and the `migrate` service have not run (no Docker here); the migration was not applied to the real development database (dry run only: one pending); `pnpm test:migrate` is not in CI (it needs a MySQL service).

## Update 2026-10-01: nothing invented on a fresh company (T30, T31, T32, T33)

**Seeded data measured, then removed.** A new company used to be shown: four invented logistics clients, bookings, drivers, SLA figures and tracking events (Company Engine); KPI values such as 84% pipeline coverage and a $28,400 deal size; stats on all 50 agents ("1284 tasks, 97% accuracy") plus a "fine-tune" button that raised accuracy by 1 on every click; five knowledge-base entries reading "Replace this placeholder" (these were injected into agent prompts and demo chat as company facts); sample valuation figures; three recurring agent tasks switched on; "Fleet online, brain linked" as static text; a spoken greeting claiming "all systems running smoothly" and an always-listening microphone started on load; a default tax rate of 20% VAT for every country. All gone:
- Operations data, knowledge base: empty. KPIs: labels and units only; a KPI with no value shows "Not set" and the department score is computed only from KPIs that have a target ("No targets set yet" otherwise). The agent prompt no longer says "all KPIs on track" when no KPI has a target.
- Agents: tasks done and success rate are computed from real agent runs (a run that errored or was stopped is not a success). The fake fine-tune action is removed.
- Scheduled agent tasks are templates, all off.
- Sidebar status is real: "N agents · AI: <provider or Demo>", or "Offline: saved on this device only" when the database is unreachable.
- Voice: off by default; the spoken greeting and the microphone only run for people who turned voice on.
- The Company Engine operations dashboard shows an empty-state note and "-" instead of made-up percentages.
- `lib/seeds.test.ts` (13 tests) enforces all of this so it cannot regress.

**T30, feature defaults.** Calls, Social, Advertising, Valuation, Fundraising and WhatsApp default off. A page whose tabs are all off (Marketing) leaves the navigation. Revenue Tracker stays on (it records real, user-entered revenue). Switch a feature on under Settings, Features. `lib/features.test.ts` fails if a new simulated or experimental feature is added switched on. Existing workspaces that never chose a value lose these tabs until they turn them on.

**T32, country-aware tax.** The default is now a 0% "set your rate" profile, not 20%. Choosing a company country (USA, Canada, Ghana) replaces the starter profiles, but only while they are untouched: Canada GST 5% and Ontario HST 13%; Ghana standard VAT 15%; the US has no federal rate so the company enters its state and local rate; everything uncertain (other provinces, Ghana levies such as NHIL and GETFund) is a 0% line to fill in. Each preset says it is a starter to confirm with an accountant. The Ghana cedi (GHS) is now a currency. Also fixed: the chosen default tax profile was only held in memory and reverted on reload; it is now stored on the profile (verified across a full reload). Accounting standards were already mapped for the US, Canada and Ghana. **Not done:** the chart of accounts is still one generic list for every country, and no tax rate has been reviewed by an accountant (T90).

**Verified** on a production build in the browser with a brand-new account: all 12 pages and every tab crawled for the known invented values (none found); zero microphone requests and zero speech calls, including after the delayed greeting would have fired; Calls and WhatsApp tabs hidden, Marketing gone from navigation; Canada preset applied from the onboarding profile; default tax profile changed to Ontario HST and still set after a full reload. **Not covered:** workspaces created before this change keep whatever they already stored (old sample data persists in their database rows); the voice opt-in path itself (turning voice on) was not exercised because the browser pane blocks the microphone.

## Update 2026-10-01: stale saves are refused (T21)

**The problem.** Every save sends a whole list (all invoices, all tasks, ...) and the server used to overwrite it blindly, so two tabs, two devices, or a tab and an agent silently destroyed each other's changes.

**What changed.**
- `borga_state` has a `version` column (migration `0002`, applied to the development database after a backup; existing rows start at 1). Every write bumps it.
- `GET /api/borga/data` returns the version of each entity. `POST` carries the version the tab last read (`baseVersion`); if the stored version has moved on, nothing is written and the server answers 409 with the current copy. The check is atomic (a conditional `UPDATE ... WHERE version = ?`), so of two saves from the same version exactly one wins. A present-but-malformed `baseVersion` is a 400, never "no check".
- The client saves through a per-entity queue (`lib/borga/save-queue.ts`): quick successive edits are coalesced and never conflict with each other. On a 409 it compares the server's copy with what it was saving (canonically, because MySQL reorders JSON keys): identical means both sides already agree and the new version is adopted silently (this covers the dashboard calling a server route that writes the same data); different is a real conflict, the entity stops saving, and a banner says which data was affected, with "Load latest".
- Changes made by the server (agents, the scheduler, heartbeat) bump versions too, so a dashboard that is open while an agent works will be refused if it then saves the same list from an older copy, instead of erasing the agent's work.

**Verified.** 12 queue unit tests (`pnpm test`); 10 live tests against a real server and MySQL (`pnpm test:concurrency`): versions reported, first save expects no row, stale save gets 409 with the current copy and writes nothing, two simultaneous saves from one version give exactly one success, a scheduler-route write makes an older copy stale, unconditional saves still work and bump the version, malformed versions give 400; the tenancy suite still passes 9/9. In a real browser with two tabs on one account: tab 1 saved, stale tab 2's edit was refused with the banner (still showing seconds later), the database kept tab 1's change and not tab 2's, "Load latest" cleared the banner and loaded tab 1's data, and tab 2's retried edit then saved with both changes present.

**What it does not do.**
- **The refused edit is lost** (the user has to make it again); there is no automatic merge. The granularity is a whole list, so any change to that list by anyone else conflicts, even to a different record. Per-record rows are still the real fix.
- **Server-side writers still race each other** (for example an agent run and the heartbeat both rewriting one list read-modify-write); they bump the version but are not themselves conditional.
- **Stale browser bundles:** a tab running code from before this deploy sends saves without a version (still accepted, so it keeps working) and gets no protection until it is reloaded.
- A save that fails for other reasons (network, 503) still falls back to the offline toast and a local copy; the next save retries with the newest value.

## Update 2026-10-01: sign-in hardening (T15) and dependency audit (T17)

**T17, dependencies.** `pnpm audit` reported 59 advisories (3 critical, 30 high). Production dependencies carried 3 critical (Next.js: two remote-code-execution flaws in the image optimiser and `next/og`, one on Windows hosts) and 5 high (nodemailer, sharp, browserslist). Fixed by upgrading `next` 16.3.1 to 16.3.8 and `nodemailer` 9.0.5 to 10.0.13 (a major bump: the only code change was the `Transporter` type import), plus `pnpm.overrides` in package.json that raise vulnerable transitive packages inside their current major version. Result: 59 advisories down to 1 (moderate: esbuild under drizzle-kit, which is only exploitable through esbuild's own dev server, which we never run; accepted, remove when drizzle-kit updates). CI now runs `pnpm audit --prod --audit-level=high` and fails on any high or critical advisory in what ships. After the upgrade: typecheck, lint, 141 unit tests, build, tenancy 9/9, concurrency 10/10, migrations 8/8, and a real SMTP send through the app to a fake SMTP server (authenticated, correct recipient, subject and sender) all pass. Re-run the audit before each release; new advisories appear without any change on our side.

**T15, sign-in.** Three weaknesses found and fixed, each shown failing on the old code and passing on the new (`pnpm test:loginsec`, live server):
- **Spoofable client address.** The rate limiter keyed on the left-most `X-Forwarded-For` value, which a client chooses, so rotating it gave unlimited fresh limit buckets. It now uses the right-most value, which only the proxy sets (`lib/auth/client-ip.ts`), rejects non-IP junk as a key, and `deploy/Caddyfile` overwrites the header with the real peer address.
- **Account enumeration by timing.** A login for an email with no account returned in about 8 ms; a real account took about 78 ms because only it ran the slow password hash. A dummy hash is now checked for unknown emails: 69 ms against 68 ms (ratio 1.01).
- **No per-account lock.** The per-IP limit does not stop one account being guessed from many addresses. After 8 wrong passwords in 15 minutes an account is locked (429 with `Retry-After`); the correct password does not bypass the lock; unknown emails are counted the same way so the lock reveals nothing; memory is bounded (an attack with endless fresh emails costs the same per request, 55 ms for 30,000 failures). Trade-off: someone can lock a known email for 15 minutes by failing on purpose; the owner can still reset the password by email.

**Not verified / still open.** The Caddy header overwrite is written to Caddy's documented `header_up` syntax but Caddy has not been run here (part of the first-run checklist). The throttle and the per-IP limiter are in memory, per process: correct for the single-instance deployment, wrong if scaled out. Signup still answers "an account with this email already exists" (visible enumeration for people who hold a valid invite). The password-reset and email-verification flows were not re-tested against a real mailbox (T16).

## Update 2026-10-01: free models for every provider, no-key providers, and the model dropdown

**What was asked.** Free model loading only worked for OpenRouter; make it work for all providers, let free providers that need no API key work out of the box, and fix the model dropdown.

**What is true, checked live against each provider (not assumed).**

| Provider | Model list without a key | Chat without a key |
|---|---|---|
| Pollinations | yes | **yes** (anonymous tier) |
| LLM7 | yes (5 of 67 models are free anonymously) | **yes**, for the models the provider itself flags as not usage-based; the other 47 return 401 |
| Ollama (local) | yes (read from your own machine) | yes |
| OpenRouter, NVIDIA NIM, SambaNova | yes | no, a free key is needed |
| Groq, Cerebras, Mistral | no (401/403) | no |
| Google Gemini | no (404 without a key) | no |

So the four providers whose list needs a key cannot load before one is saved. They now say so plainly ("needs your free API key") instead of failing, show a starter list in the meantime, and **load their live list automatically the moment the key is saved**. Public lists (OpenRouter, NVIDIA, SambaNova, Pollinations, LLM7) load by themselves the first time the AI & Voice tab is opened, with no clicks.

**Providers that work with no account.** Pollinations and LLM7 are new presets, shown as "ready" with a warning, because they are community-run services: prompts go to a third party, anonymous tiers are throttled (a burst of requests got 402 and 429), and they can change or disappear. Do not use them for confidential company data; the card and the "Use as default" toast both say so. A rate-limited reply now says it was rate limited instead of "had trouble reaching the model". A keyless provider no longer borrows NVIDIA's key name in the chat route (a latent bug for any provider without a key variable).

**The dropdown.** The old native select had several real faults: it was disabled until a key existed (so you could not browse), it could show one model while "Use as default" sent a different, stale one after the list was reloaded, it had no search (NVIDIA has 70 models), and nothing told you when a saved model was not in the list. Replaced by one searchable, grouped picker (`ModelPicker`: Radix popover + cmdk) used in every provider card and in the per-agent model override. It is always usable, requires every typed word to match (fuzzy matching let unrelated ids through), accepts a custom model id, and shows a saved id that is not in the list as a "custom id" instead of silently changing it. Also fixed: all 50 seeded agents pointed at five NVIDIA model ids that exist in no catalog and would have failed once an NVIDIA key was saved; they now use the workspace default.

**Verified.** Every provider's list through the real route (table above); keyless chat and the Test button through the app for Pollinations ("2+2 equals 4.") and LLM7 with no key anywhere; rejection path with bogus keys (Cerebras and Mistral: clear 401 message); in a real browser: auto-load on first visit, search ("llama 70b" gives exactly 4 models), selection, Use as default and Test on the keyless LLM7 card ("Replied in 390 ms"), the default surviving a full reload, and the picker working inside the agent edit dialog. 16 model-catalog tests, 155 unit tests in all.

**Not verified.** No real keys were available, so the live lists for Groq, Gemini, Cerebras and Mistral follow their documented response shapes but have not been read from the real services. Ollama's "load installed models" was only checked in the not-running case. The free/anonymous quotas of Pollinations and LLM7 are the providers' own and may change.

## Update 2026-10-01: every ISO currency, and country / state / city dropdowns

**Currencies.** The company currency used to be one of five hard-coded codes. Now every ISO 4217 code is selectable (180: the 179 in the `currency-codes` package, MIT, plus XCG, the Caribbean guilder that replaced the Netherlands Antillean guilder in 2025 and is not in the package yet; the supplement is in `lib/borga/currencies.ts` and drops out when the package catches up). Real currencies come first; metals, funds, XDR and the test code are listed after them under their own heading so nothing in ISO 4217 is missing. Search by code, name or symbol ("ghs", "cedi", "naira", "₦"). Symbols come from the platform (`C$` for CAD and `GH₵` for GHS are kept by hand). `Workspace.currency` is now any ISO code, and `CURRENCY_SYMBOL` resolves any code, so the 49 existing uses work unchanged.

**Country, state, city.** Country (252), state or province (3,865) and city (168,772 places with more than 1,000 people) are searchable dropdowns that cascade: choosing a country resets the state and city and, when creating a company or in onboarding, suggests that country's currency (unless you already chose one); a state limits the city list to that state. Search ignores case and accents ("montreal" finds "Montréal"). Anything not in a list can still be typed (a small town, an unusual region), and a saved value that is not in the list is shown as it is. Used in the company create and edit dialog, onboarding, the customer form (country, state, city) and the vendor form (country, city), replacing the old hard-coded lists. Values are stored as names, as before, so the accounting standard and tax presets (which match on "United States", "Canada", "Ghana") keep working.

**Licensing decision.** The obvious package, `country-state-city`, is GPL-3.0. A copyleft library in a commercial product (and in the desktop build you distribute) is a licensing risk, so it is not used. The data comes from GeoNames, licensed CC BY 4.0, which requires attribution only: `data/geo/ATTRIBUTION.md` carries the credit and **the credit must also appear in the product's legal or about page (T80)**. The files are generated by `scripts/build-geo.mjs` and committed (4.4 MB, one file per country), so builds never need the network; run the script to refresh. They are served by an authenticated route (`/api/borga/geo`, parameters validated because they select files) and shipped in the Docker image.

**Verified.** 10 new tests (165 in all) cover the search, the lookups, completeness of the data (every country has a file, Canada has its 13 provinces, Ghana its 16 regions, the US its 50 states, and the launch cities), that every country currency exists in ISO 4217 (this caught the missing XCG), and symbols and decimal places. The route was checked live: valid requests, path traversal and bad codes (400), no session (401), the US-wide city list capped at 1,500 of 12,351. In a real browser: wizard country and currency, the full Canada, Ontario, Ottawa and Ghana, Greater Accra cascade inside the company dialog, a custom city, the saved values, the edit dialog preloading them, and the customer and vendor forms. Two bugs found by that testing and fixed: after picking an item the search box kept the old text, so the next open showed a filtered list (also in the model picker); and a currency lookup test that used the wrong input.

**Limits.**
- Cities with fewer than 1,000 people are not listed (type them). Names are in English only.
- Selecting a currency does not yet change how amounts are rounded: money formatting still shows two decimals, which is wrong for zero-decimal currencies such as JPY or three-decimal ones such as KWD. Decimal places are available (`currencyDigits`) but not applied to the app's money helpers.
- GeoNames is community-maintained; some admin names differ from official ones.
- Tax presets and accounting standards still exist only for the US, Canada, Ghana (and Denmark's standard); other countries get the neutral 0% tax placeholder and the IFRS default.
