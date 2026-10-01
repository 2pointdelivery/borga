# Hosting Borga for free

Borga needs a **Node server** (Next.js), a **MySQL-compatible database** (`mysql2`), outbound **SMTP**, optional outbound
**IMAP**, and something that calls `POST /api/borga/cron` about every 5 minutes (heartbeat, mailbox poll, SLA sweep).
That rules out Cloudflare Workers/Pages (no mysql2/IMAP sockets) and static hosts.
Free tiers change often, so confirm current limits before committing. The facts below were checked 2026-09-30.

## Recommended: Oracle Cloud Always Free VM + Docker (free and always on)
- Always Free allows up to 4 Arm cores / 24 GB RAM and 200 GB disk. The VM never sleeps, so the heartbeat and IMAP polling just work. Oracle may reclaim VMs that sit idle, so keep the cron hitting it.
- Run `docker compose` with this repo's `Dockerfile` image, `mysql:8`, and Caddy (automatic HTTPS; a free hostname via DuckDNS).
- Cons: a card is needed for signup, Arm capacity is sometimes unavailable in a region, and you patch the OS yourself. Outbound port 25 is blocked, so use 587 through a mail provider.

## Easiest: web service + free MySQL + free pinger
| Piece | Free option | Catch |
|---|---|---|
| App | **Koyeb** free instance (no sleep) | card hold at signup since Feb 2026 |
| App (alt) | **Render** free web service (750 h/mo) | sleeps after 15 min idle, **blocks outbound SMTP on 25/465/587** (ticket replies would fail; use a provider on port 2525 or an HTTP mail API), no persistent disk |
| Database | **TiDB Cloud Starter** (MySQL-compatible; 5 GiB + 50M request units/mo, no card) | metered in request units, so full-table scans burn quota |
| Scheduler | **cron-job.org** -> `POST /api/borga/cron` with `Authorization: Bearer $CRON_SECRET` | 5-minute granularity; also keeps Render awake |
| Email out | Brevo / Resend free tiers via SMTP | daily caps, verify current numbers |
| Email in | **Cloudflare Email Routing -> Worker -> inbound webhook** (see docs/TICKETING.md) | needs a domain you control |
| LLM | Groq free tier or Ollama; the demo provider needs no key | rate limits |

Vercel Hobby runs the Next app, but its terms are non-commercial and its cron is too coarse for heartbeat/IMAP. Not recommended for a business.

## Required environment
`DATABASE_URL`, `SESSION_SECRET`, `BORGA_SECRET_KEY` (64 hex chars), `CRON_SECRET`, `SMTP_*` + `EMAIL_FROM`.
Optional: `BORGA_ADMIN_TOKEN`, `BORGA_FEATURES_OFF`. Run `pnpm db:migrate` once.
Never bake `.env` into an image (the Dockerfile no longer does).

## Free-tier hardening checklist
- Set `BORGA_FEATURES_OFF` for anything simulated (`calls,social,valuation,...`) so users are not shown fake features.
- Set `BORGA_SECRET_KEY` explicitly. Otherwise stored secrets are encrypted with a hash of `DATABASE_URL`.
- Back up the database (`mysqldump` on a schedule); free databases are not backed up for you.
