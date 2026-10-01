# Project-to-Completion prompt: Borga (ready to use)

Paste everything below the line into a new chat. Items marked **[FILL]** are the few things only you can supply; everything else reflects the repository as of 2026-10-01. Update the "Current status" block whenever the project changes.

---

Act as my senior Project Delivery Director, Operations Lead, Product Manager and Quality Assurance strategist. Take the project below from its current state to a verified, documented and formally accepted completion.

Be practical and execution-focused. No generic project-management advice. Identify missing information, assumptions, risks, dependencies and next actions that determine whether this project finishes.

## HOW TO WORK (read first)

1. **Evidence over assertion.** Treat "almost finished" as incomplete until its acceptance criterion is met. Mark an item *Complete* only with evidence (a passing test, a verified run, a signed approval). "Tested against a local fake" is **not** the same as "verified against the real service": record the difference.
2. **Ground yourself in the repo before planning** (if you have file access): read `docs/MATURITY.md`, `docs/REAL_FEATURES_PLAN.md`, `docs/HOSTING.md`, `docs/TICKETING.md`, `docs/SUPERMEMORY.md`, `docs/COMPANY_ENGINE.md`, `docs/EMAIL_UPDATES.md`, `deploy/README.md`, `lib/borga/features.ts`, and run `pnpm typecheck && pnpm lint && pnpm test`. If you cannot read files, say so and plan from the status block below, flagging every assumption.
3. **Deliver in four parts** so nothing is truncated, pausing after each for my "continue": **Part 1** = A-D, **Part 2** = E-G, **Part 3** = H-J, **Part 4** = K. Part 1 must be complete before Part 2 starts.
4. **Ask at most 5 questions, and only if the answer changes the plan.** Put them at the very start of Part 1 together with your recommended default for each, and proceed on the defaults if I do not answer.
5. **Dates:** today is 2026-10-01. Use calendar dates, assume one full-time developer plus me as owner/approver unless I say otherwise, and state effort in hours.
6. Separate **mandatory for launch** from **optional improvements**. Protect the project from scope creep: anything not in the Definition of Success is parked in a "Later" list.

## PROJECT INFORMATION

**1. Project name:** Borga, a multi-company AI business operating system (Next.js 16, React 19, TypeScript, MySQL via a JSON key-value store, Zustand).

**2. Project type:** SaaS web platform (self-hosted), with a local Electron desktop wrapper. AI agents, integrations and finance/CRM/support modules.

**3. Business objective:** one place where a company runs sales, finance, support, HR and agent-driven automation, with AI agents that act only with human approval. **[FILL: the commercial goal: who pays, pricing model, first target customers, revenue target.]**

**4. Desired final outcome ("done"):** a hosted production deployment (Oracle Cloud Always Free, public HTTPS) that real companies can sign up to and use for the core modules without fake data, with every shipped feature either genuinely working or switched off by a feature flag; documented operations (backup, restore, update, cron); and formal acceptance by the approver below. **[FILL: confirm or amend.]**

**5. Current project status** (verified unless marked unverified):

*Built and passing checks (typecheck clean, lint 0 errors / ~24 warnings, 73 unit tests, production build OK):*
- Core: auth/sessions, multi-company workspaces, dashboards, CRM/customers, pipeline, invoicing, recurring invoices, vendors & AP, recurring vendor bills, ledger/accounting, banking (account kinds incl. all payment methods), budgeting, reports, HR, projects, knowledge base, agent fleet + runner + approvals gate, heartbeat/cron endpoint.
- Support Desk: tickets, SLA engine, mailbox (IMAP + inbound webhook), threaded replies, agent tools. IMAP/SMTP verified only against local fake servers.
- Feature flags (per workspace + `BORGA_FEATURES_OFF`), connections store (per-workspace encrypted credentials), signed webhooks (Meta/Twilio), sync-job runner, record store.
- AI settings consolidated (Integrations → AI & Voice: keys, default model, live Test).
- Company Engine (CRM pull into customers/deals), Revenue Tracker driven by company services, email updates + digest, optional Supermemory memory layer. All verified against local fakes only.
- Deployment kit (`deploy/`: compose, Caddy, MySQL init, backups, systemd timers), written and syntax-checked but **never run** (no Docker locally).

*Not started or not real yet (by `docs/REAL_FEATURES_PLAN.md`):* Phase 1a-1b (ledger-based revenue actuals/valuation snapshots; ASC 606 / IFRS 15 recognition), Phase 2 (fundraising CRM + agent research), Phase 3 (WhatsApp inbound/templates), Phase 4 (Twilio calls USA/Canada/Ghana + voicemail), Phase 5 (social publishing via Composio), Phase 6 (Google/Meta/LinkedIn/ChatGPT Ads sync, market comps). Features flagged experimental or simulated: calls, social, advertising, valuation, fundraising, WhatsApp, revenue tracker.

*Known defects / hardening gaps (from `docs/MATURITY.md`):* ~130 uncommitted files (nothing in git history for most recent work); migration `drizzle/0001` not applied; some secrets (SMTP/LLM) are deployment-wide, not per user; whole-array client persistence is last-write-wins and DB errors can fall back to seed data; recurring invoices/bills and CRM auto-pull only run while the dashboard is open; in-memory rate limiter; thin route/auth/store test coverage; sample logistics data in the Company Engine "Operations dashboard".

**6. Scope**
*Included (launch):* items in the "Built" list above that are not flagged experimental, deployed and verified on the production host; backup/restore; monitoring; user documentation; the P0/P1 items in `docs/MATURITY.md`.
*Excluded until after launch (unless I say otherwise):* Phases 1b-6 of the real-features plan, ASC 606 engine, ad-platform connectors, calls, social publishing, WhatsApp. These stay behind feature flags marked experimental. **[FILL: confirm this launch/later split, it is the most important scoping decision.]**

**7. Deliverables:** production deployment on Oracle Cloud; source in a version-controlled repository with CI; Docker image; operations runbook (deploy, backup/restore, update, rotate secrets, cron); user guide and onboarding flow; admin/security checklist; test evidence; handoff pack (accounts, domains, keys, ownership); a signed acceptance record.

**8. Stakeholders and approvers:** **[FILL: names, roles, final decision-maker, who can approve spend, who signs off legal/compliance, who is the first customer/pilot user.]**

**9. Team and resources:** **[FILL: developers, QA, operations, designers, accountant (needed to sign off any revenue-recognition rules), legal/counsel (call-recording and data-protection wording for USA, Canada and Ghana), budget, tools.]** Known tooling: pnpm, Next.js, MySQL 8, Drizzle, Docker (not yet installed locally), Oracle Always Free VM, Caddy, systemd timers, GitHub Actions CI.

**10. Deadline and milestones:** final completion **[FILL: date]**. Proposed milestones to confirm: repo committed and CI green; production deployed and health-checked; pilot company onboarded; acceptance sign-off.

**11. Constraints:** free-tier hosting (Oracle Always Free; capacity and idle-reclamation risk); no paid data feeds (public sources only for market comps); bring-your-own credentials for Meta, Google Ads, LinkedIn, Twilio; Ghana/Canada/USA regulatory scope; no automated customer emails or payments without human approval; SMTP is a single deployment-wide sender.

**12. Known blockers, risks and unresolved decisions:** ChatGPT Ads API spec and credential not yet supplied; no real-account verification of Twilio/Meta/IMAP/SMTP/Supermemory/CRM; Oracle account and domain not confirmed **[FILL]**; accountant review for ASC 606 rules; counsel review of call-recording consent; Twilio Ghana number availability; whether launch is single-tenant or multi-tenant (several secrets are not yet per-tenant); data-loss risk from uncommitted work.

**13. Existing project materials:** repository `C:\laragon\www\comprun` (see the docs listed in "How to work"); `.github/workflows/ci.yml`; `deploy/`; test scripts `scripts/smoke-supermemory.mjs`. **[FILL: links to Figma, contracts, customer feedback if any.]**

**14. Definition of success:** the project is successful only when **all** of these are true (edit freely):
1. `main` is committed, CI (typecheck, lint, test, build) is green, and the repo has a tagged release.
2. Production is live on HTTPS; `/api/health` shows the database connected; a clean-VM redeploy and a backup-restore drill both succeed and are documented.
3. No P0 item from `docs/MATURITY.md` is open; no known cross-tenant data exposure; session and encryption secrets are set in production.
4. Each launch-scope module passes a written UAT script with a pilot company: zero open critical defects, at least 95% of UAT cases passing, and no fabricated data visible.
5. Every experimental/simulated feature is either verified against the real service or switched off by default in production.
6. Real mail path verified (SMTP out, IMAP/webhook in) with the production provider.
7. Operations runbook, user guide and admin checklist exist and were followed by someone other than the author.
8. The approver gives written sign-off. **[FILL: add revenue, user or customer targets if applicable.]**

## REQUIRED OUTPUT: Project-to-Completion Execution Plan

**A. Executive completion summary.** Project, present condition, purpose, final state, deadline, primary threats. State plainly whether it is realistically completable by the deadline, and the assumptions behind that answer.

**B. Completion gap analysis.** Table: deliverable/requirement | status (Not started / In progress / Needs review / Complete) | evidence of completion | remaining work | owner | dependency | priority (Critical/High/Medium/Low) | target date | approval required (Y/N). Distinguish "verified on a local fake" from "verified live".

**C. Critical path.** The exact tasks that set the finish date, in dependency order; what happens if each slips; what can run in parallel.

**D. Work breakdown structure.** Every remaining task with: ID, name, definition of done, owner, estimate (hours), deadline, priority, dependencies, required inputs/access, output, quality-check method, approval needed. No vague tasks ("finish development", "test system", "prepare launch"); break them into verifiable actions.

**E. Execution plan.** 30-day plan; weekly sprints; first 5 business days; a daily checklist for me. Rank every action: Must do now / Must do this week / Can delegate / Can defer / Not necessary for completion.

**F. Risk, blocker and decision register.** Table: item | type (Scope/Technical/Financial/Legal/Operational/Partner/Schedule/Quality/Security) | probability | impact | early warning sign | owner | mitigation | contingency | decision deadline | escalation path. Emphasise what can block launch, acceptance, legal compliance, customer use or operational readiness (for example: Oracle capacity, deliverability, tenant isolation, data loss, call-recording law).

**G. Quality assurance and acceptance plan.** Checklist covering functional requirements, technical testing, security and permissions, data validation, integration testing, UAT, operational readiness, documentation, training, legal/financial/compliance review, sign-off, launch/handoff. For each item: verification method, owner, required evidence, pass/fail criteria, approval authority.

**H. Stakeholder communications.** Draft: status update; completion-risk escalation; request-for-decision; final acceptance/sign-off; completion announcement; vendor/partner follow-up. Professional, concise, with the recipient's required action and a deadline in each.

**I. Handoff and closeout plan.** Closeout checklist: deliverables transferred; access, credentials and ownership confirmed; repo/APIs/domains/cloud resources documented; SOPs; training; support and escalation contacts; invoices/contracts reconciled; warranty and maintenance periods; final acceptance; post-launch monitoring; archive; lessons learned.

**J. Metrics and final scorecard.** Scope completion %, open critical defects, UAT pass rate, budget variance, timeline variance, documentation completion, training completion, stakeholder approval, operational readiness score, post-launch incident threshold. Provide Red / Amber / Green definitions for each.

**K. Immediate next actions.** Exactly: the 10 most important actions, each with owner, deadline, and the consequence of not doing it; plus a short message I can send today to start execution.

## RULES
- Be direct and specific; use tables wherever practical.
- Do not assume anything is complete without evidence.
- Highlight missing information that could cause failure, and recommend the minimum viable path to completion if time or budget is short.
- If a choice is unresolved, recommend a decision with reasoning and a deadline.
- Prioritise revenue, customer impact, operational readiness, security, legal compliance and stakeholder acceptance.
