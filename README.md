# Borga — AI Company OS

An agentic, workspace-based (multi-company) business suite: a full-stack CRM covering sales,
marketing, advertising, fundraising, finance & reporting, HR, company valuation and analytics —
with unified messaging (email / SMS / WhatsApp / Telegram), end-to-end encrypted live chat, and
composio.dev-powered OAuth integrations.

## Modules

Ten top-level themes, each with a tabbed sub-menu:

- **Overview** — Command Center — Analytics (health score, funnel, engagement) — KPIs & Reports
- **Sales** — Pipeline (kanban) — Customers (accounts + contacts CRM with account intelligence) — Invoicing (full CRUD)
- **Marketing** — Social Media scheduling — Advertising campaigns (spend / ROAS)
- **Communications** — Unified Inbox (email / SMS / WhatsApp / Telegram with composio.dev OAuth) — E2E encrypted live chat — Calls
- **Finance** — Ledger — Accounting (chart of accounts, double-entry journal, trial balance) — Banking (CSV import, reconciliation engine, composio.dev/Plaid linking) — Vendors & AP (vendors + bills) — Reports (P&L, balance-sheet snapshot, CSV export)
- **HR** — Directory — Time Off (leave approvals) — Teams
- **Company** — Companies (multi-workspace management) — Valuation model — Fundraising — Knowledge Base
- **AI Platform** — Agents — Agent Runner — 2point Engine — Planner — Activity Log
- **Integrations** — Composio Toolkits — AI & Voice keys — Connected Apps
- **Settings**

Every module is scoped to the active company workspace. Workspaces are created/switched from the
topbar switcher or managed under **Company → Companies**. Data is persisted per-workspace as JSON
documents in Postgres (`ws::<id>::<entity>` keys in `borga_state`).

## Tech Stack

- Next.js 16 (App Router) — React 19 — TypeScript 5
- Tailwind CSS 4 + shadcn-style primitives (`components/ui/`) + lucide icons + recharts
- Drizzle ORM + PostgreSQL (`postgres` driver)
- Zustand state management with fire-and-forget persistence (`/api/borga/data`)
- WebCrypto (ECDH + AES-GCM) for end-to-end encrypted chat
- composio.dev REST v3 proxy for OAuth toolkit connections (`/api/borga/composio`)

## Getting Started

1. **Install**: `pnpm install`
2. **Env**: copy `.env.example` → `.env`, set at minimum `DATABASE_URL`. Optional:
   `COMPOSIO_API_KEY`, LLM provider keys (`GROQ_API_KEY`, `OPENAI_API_KEY`, etc.),
   `ELEVENLABS_API_KEY`.
3. **Run dev** (port 13000): `pnpm dev`
4. **Verify**: `pnpm test && pnpm typecheck && pnpm build`
5. **DB**: `pnpm db:generate` / `db:migrate` / `db:studio`

## Project Structure

- `app/` — App Router root + `api/borga/*` route handlers (data, composio OAuth, chat, calls,
  webhooks, scheduler)
- `components/borga/` — dashboard shell, grouped navigation (`nav.ts`), workspace switcher &
  dialogs, voice assistant, command palette, and one panel per module in `panels/`
- `lib/borga/` — domain types & seeds (`data.ts`), Zustand store (`store.ts`), Postgres
  persistence, E2E crypto helpers (`crypto.ts`), agent context/tools/secrets
- `components/ui/` — shadcn-style primitives; `hooks/`, `utils/`, `scripts/`

## Deployment

The app itself (this directory) is a dynamic, database-backed Next.js server — it needs a Node
host (see `Dockerfile`, `wrangler.toml` / `open-next.config.ts` for Cloudflare) and cannot run on
static hosts like GitHub Pages. The marketing landing page has been split out into
[`landing-site/`](landing-site/README.md) as a standalone static export specifically so it *can*
be hosted on GitHub Pages, deployed automatically by `.github/workflows/deploy-landing.yml`.

## Security notes

- API writes are gated by a CSRF custom header (`X-Borga-Client`) plus optional shared-secret
  (`BORGA_ADMIN_TOKEN`) and rate limiting in `proxy.ts`.
- Encrypted chat stores only ciphertext + IV; private keys never leave the browser's local
  storage. Verify peer fingerprints before trusting a channel.
- Secrets pasted into Tools are stored server-side (env-first, then encrypted DB) and never
  returned to the client in plaintext.
