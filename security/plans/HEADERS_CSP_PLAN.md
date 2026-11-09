# Headers + CSP Nonce Plan — implemented

## Changes

- `proxy.ts` — per-request nonce (`x-nonce` to Next.js + full nonce CSP on responses); `CSP_NONCE=off` escape hatch; dev keeps unsafe-inline/eval; matcher extended to all HTML pages; `upgrade-insecure-requests` in prod policy.
- `next.config.ts` — static policy minus `script-src` (avoids dual-policy intersection); other directives unchanged.
- `app/layout.tsx` + `components/AnalyticsGate.tsx` — explicit nonce threading for the analytics script.
- `deploy/Caddyfile` — HSTS `includeSubDomains` aligned with the app.
- `package.json` — all deps pinned exact; lockfile regenerated; frozen install verified; `pnpm audit --prod` clean.

## New files

- None (config + proxy only).

## Verification goals

- [x] `pnpm typecheck`; boot serves pages (curl 200s).
- [ ] Manual: HUMAN — open every core page with devtools console open: zero CSP violations; confirm `script-src` has `nonce-` and no `unsafe-inline`; confirm nonce differs per reload. If anything breaks: `CSP_NONCE=off` + restart reverts instantly.

## Manual verification (for the human)

- `curl -sI` a page: one `Content-Security-Policy` with `nonce-`; static asset: policy without `script-src`.
- New top-level pages must add matcher entries in `proxy.ts` (fail-open otherwise — noted, not silent).
