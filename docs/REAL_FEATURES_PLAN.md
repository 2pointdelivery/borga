# Plan: turn every experimental / simulated feature into a real one

Scope (decided 2026-10-01): **all 7** flagged features. Estimates are rough single-developer weeks and exclude third-party approval waiting time. Total is roughly **24 weeks** of build.

## Decisions (2026-10-01)
| Topic | Decision | Consequence |
|---|---|---|
| Market comps | Publicly available information only (no paid feed) | Provider interface with keyless defaults (SEC EDGAR fundamentals + a free price source), optional free-tier keys, peer list per workspace. Verify each source's terms and limits when building |
| Ad and phone integrations | **Bring-your-own credentials**: users configure Meta, Google Ads, LinkedIn and Twilio in the app | Guided setup + connection test in Phase 0. No shared OAuth app, so no app-review dependency on us; each customer uses their own developer token or app |
| ChatGPT Ads | You will supply the API | Connector is blocked until the spec and a test credential arrive; scheduled last |
| Revenue recognition | **Straight-line and full ASC 606 / IFRS 15** (multi-element) | Phase 1 splits into 1a and 1b (+~3 weeks). Needs an accountant's review of the rules |
| Calls | USA, Canada, Ghana | Geo-permissions, per-country consent announcement, spend cap; Ghana number/regulatory availability to verify in Twilio |
| Hosting | Oracle Cloud Always Free VM | Phase 0 adds a deployment kit; public HTTPS URL for webhooks; a systemd timer replaces an external pinger |

| Feature (flag) | Today | Target ("real") |
|---|---|---|
| Revenue Tracker (`revenueTracker`) | Manual projection grids | Forecast vs **actuals from the ledger**, plus **recognition schedules** (straight-line and ASC 606 / IFRS 15) posting journal entries |
| Valuation (`valuation`) | Static industry-multiple table, illustrative price-history and radar | Valuation from live ledger data, **saved snapshots** as real history, **market comps** from public sources |
| Fundraising (`fundraising`) | Manual list | Real **investor/grant CRM pipeline** + **agent web research** with human review |
| WhatsApp (`whatsapp`) | Outbound send via Meta Cloud API | **Inbound** into Unified Inbox, delivery status + templates, **linked to Customers and Support tickets** |
| Calls (`calls`) | Simulated progress | **Twilio inbound + outbound + voicemail**, call log, recordings, status webhooks |
| Advertising (`advertising`) | Hand-typed numbers | Daily **sync** from Google, Meta, LinkedIn, ChatGPT Ads, plus **CSV import** |
| Social (`social`) | Planner; "publish" posts nothing | Publish and schedule **via Composio toolkits**, store post URLs, honest per-post status |

## Graduation rule (applies to every feature)
A feature moves `experimental`/`simulated` → `beta` → `stable` in `lib/borga/features.ts` only when all hold:
1. No fabricated or illustrative data on screen; every number traces to a real source or user input.
2. Every action either performs the real thing or fails with a readable error (never fake success).
3. Server-authoritative writes (no whole-array client overwrite), validated with zod, workspace-scoped, behind its feature gate.
4. Unit tests for the logic plus one end-to-end run against a real or faithful fake counterpart (as done for IMAP/SMTP).
5. Documented setup, an operator kill switch, and the related `docs/MATURITY.md` items closed.

`beta` = passes 1-4 in a real account. `stable` = a week of real use with no data-integrity bugs.

## Phase 0: Foundations, credentials UI, deployment (~2 weeks; blocks phases 3-6)
**Status (2026-10-01): built and verified locally, except the Oracle deployment (written, not run: no Docker here).** Shipped: per-workspace encrypted connection store + Connections tab (`lib/borga/connections-server.ts`, `providers.ts`, `provider-tests.ts`), signature-verified public webhooks (`/api/borga/hooks/{meta,twilio}`), sync job runner (`sync-jobs.ts`, wired into cron), one-row-per-record store (`records.ts`), `deploy/` kit, and the repaired inbound/outbound business-event webhooks. Still open: ChatGPT Ads spec, real provider credentials for the Test buttons (verified so far against the live APIs with bogus credentials and with mocked fetch), and a real Oracle first deploy.
Closes MATURITY P0 items 2 and 3.
- **Per-workspace connection store.** Replace the global `api_secrets` row for integration tokens with encrypted, user+workspace-scoped records plus OAuth refresh handling. The global store stays only for deployment-level keys (SMTP, LLM).
- **Credential setup UI** (Settings → Integrations): per-workspace forms for Twilio (SID, token, numbers), Meta (app id/secret, access token, ad account, WhatsApp phone-number id + verify token), Google Ads (developer token, OAuth client, customer id), LinkedIn (client id/secret, ad account), ChatGPT Ads (when the spec arrives). Each has a **Test connection** button, a "how to get these" checklist, and shows only masked values.
- **Public webhook framework.** One authenticated receiver pattern: per-workspace token or provider HMAC signature (Meta `X-Hub-Signature-256`, Twilio `X-Twilio-Signature`), replay/dedupe, user-scoped keys, proxy exemption. Fix or retire `webhooks/inbound` on top of it.
- **Sync job runner.** Generalize the cron hook (as done for tickets): per-feature sync with last-run, last-error and backoff, visible in the UI.
- **Server-authoritative storage helper** for new entities (one row per record, as tickets).
- **Oracle deployment kit** (`deploy/`): docker compose (app + MySQL 8 + Caddy HTTPS), env template, nightly `mysqldump` backup with retention, systemd timer calling `/api/borga/cron`, update script. Needs a public HTTPS hostname for Twilio/Meta webhooks.
- Exit: framework tests pass; Twilio signature verified with a replayed request; the stack boots on a clean Oracle VM and survives a restart.

## Phase 1a: Revenue Tracker actuals + Valuation on your own data (~2.5 weeks)
- **Actuals** per line/month from invoices and ledger, with variance and rollups; drop hand-typed actuals. Edge cases: voided entries, currency, partial payments.
- **Valuation** from live revenue, growth and margin; editable multiples with the source noted; **snapshot saved** on demand and monthly via cron so history is real. Remove the illustrative radar and fabricated price-history chart. (Market comps arrive in Phase 6.)
- Exit: snapshots form a true time series; no illustrative visuals remain.

## Phase 1b: Revenue recognition, straight-line then ASC 606 / IFRS 15 (~5 weeks)
- **Straight-line and milestone schedules** per contract/invoice: monthly entries to deferred/recognized revenue, idempotent, **respecting Book Closure locks**, reversible.
- **Five-step contract model:** (1) contract with customer; (2) **performance obligations** (distinct goods/services, bundles); (3) transaction price including **variable consideration** (discounts, rebates, usage, with a constraint estimate) and a financing-component flag; (4) **allocation by standalone selling price** (SSP table, relative allocation, residual where allowed); (5) recognition **over time** (time elapsed, % complete, units delivered) or **at a point in time**.
- **Contract modifications** (separate contract, prospective, cumulative catch-up), **contract assets/liabilities**, remaining-performance-obligation (RPO) report, disclosure-ready roll-forward.
- Every recognition event posts a balanced journal entry linked to the contract and obligation, with an audit trail and a recalculation preview before posting.
- Exit: worked examples from the standard (bundle with discount, variable consideration, mid-term modification) reproduce expected entries to the cent in tests; **a qualified accountant signs off the policy rules** before this graduates past beta. The software supports accounting, it is not an accounting opinion.

## Phase 2: Fundraising CRM + agent research (~2 weeks)
- Pipeline of investors/grants with stages, contacts, amounts, deadlines, notes, document links and reminders feeding the heartbeat/notices.
- **Agent research:** a scheduled agent uses `web_search`/`web_research` to propose matches for the company profile; results land in a **review inbox** with sources and a stated rationale. Nothing is added to the pipeline, and no outreach is sent, without a human accept. Remove the model-invented `matchScore`.
- Exit: every opportunity has a real source URL; reminders fire; discovery is reviewable and attributable.

## Phase 3: WhatsApp (~2.5 weeks; needs Phase 0 and a verified Meta number)
- Signature-verified inbound webhook into the Unified Inbox with per-contact threads and dedupe.
- Delivery/read statuses; **template messages** for sending outside the 24-hour window, with clear errors when a template is required.
- **Link conversations to Customers** (match by phone) **and to Support Desk tickets** (create or attach a ticket from a thread; ticket replies can go out over WhatsApp).
- Exit: round trip with a real test number: inbound threads, outbound shows delivered/read, ticket link works.

## Phase 4: Calls with Twilio (~3 weeks; needs Phase 0 and a Twilio number)
- Outbound dialing, **inbound** routing to a configured destination, **voicemail** with recording and transcription (Deepgram already integrated), status webhooks, call log with true duration and cost.
- **Countries: USA, Canada, Ghana.** Enable only those in Twilio geo-permissions and block other destinations. Check Twilio's Ghana number availability and any regulatory bundle/address requirement early; inbound there may need a forwarding or alternative number.
- **Recording consent:** default to a spoken announcement on every recorded call (the US has all-party-consent states, Canada has notification expectations, and Ghana's Data Protection Act 2012 expects notice/consent). Wording is configurable per country and recording can be switched off per workspace. Have counsel confirm the wording.
- Cost guard: daily spend cap and an approval gate for outbound calls, per the existing "never spend without asking" rule.
- Remove the simulated progression entirely.
- Exit: real inbound/outbound/voicemail calls appear in the log with true timestamps and durations.

## Phase 5: Social via Composio (~1.5 weeks)
- Publish and schedule through the connected Composio toolkits; store the returned post URL/id; per-post status `queued/published/failed` with the provider error; scheduling executed by the cron job.
- Engagement metrics only where a toolkit exposes them; otherwise blank, never zero-faked.
- Exit: a scheduled post publishes by itself and shows its live URL.

## Phase 6: Advertising sync + market comps (~4 weeks)
- **CSV import first** (no approvals): column mapping for spend, impressions, clicks, conversions, revenue; dedupe by campaign+date.
- **Connectors** (each behind its own sub-flag): Google Ads, Meta Ads, LinkedIn Ads using each customer's own credentials from Phase 0. Daily sync job storing daily rows (not just totals); ROAS from conversion value.
- **ChatGPT Ads:** built last from the API spec and credential you will supply; CSV until then.
- **Market comps for Valuation (public information only):** provider interface with **SEC EDGAR** (free fundamentals for US-listed companies) and a free price source as defaults, optional free-tier keys. Users pick **peer companies** (suggested by industry/SIC code); we compute EV/revenue and EV/EBITDA medians, cache results, and always show as-of date, source and sample size. Coverage of Canadian and Ghanaian companies will be limited and is labelled. Check each source's terms and rate limits when building.
- Exit: a connected account's daily spend matches the platform's own UI to the cent for a test day.

## Cross-cutting
- Each phase ends with a `docs/MATURITY.md` update and the flag status change.
- Add route and store tests as you go, plus a smoke script per integration using faithful fakes where sandbox accounts are unavailable.
- Agent tools for each feature follow the ticket pattern: read freely, drafts only for anything that contacts a person or spends money.

## Remaining open items
1. **ChatGPT Ads API:** send the spec and a test credential before Phase 6.
2. **Accountant:** review the ASC 606 / IFRS 15 rules before Phase 1b graduates. Which standard governs your reporting: US GAAP, IFRS, or both?
3. **Oracle Cloud account** created, and a **domain name** (or DuckDNS) for HTTPS, needed in Phase 0.
4. **Counsel** to confirm call-recording wording for the US, Canada and Ghana.
5. **Twilio:** which Ghana capability is needed (outbound only vs a local inbound number)?
6. **Valuation peers:** default peer lists per industry, or only user-chosen peers?
