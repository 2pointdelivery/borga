# Auth / Access-Control / Rate-Limit Fix Plan — implemented

## Changes

- `app/api/borga/browse/route.ts`, `app/api/borga/wigolo/route.ts` — in-handler `sessionUserId` checks (proxy-independent).
- `app/api/borga/mcp/oauth/callback/route.ts` — binds completion to the initiating session when one is present.
- `lib/borga/api-throttle.ts` (new) + `lib/borga/api-auth.ts` — 120/min per key/session-user on all v1 routes, 429 + Retry-After.
- `app/api/auth/forgot/route.ts` — per-email throttle (reuses `LoginThrottle`).
- `app/api/v1/equity/holdings|/safes` — `stakeholderId` must exist on the workspace cap table.
- `scripts/tenancy.test.mjs` — new-entity seeds, cross-tenant dedicated-route refusal, v1 key scoping + revocation.

## New files

- `lib/borga/api-throttle.ts`, `lib/api-throttle.test.ts`.

## Verification goals

- [x] `pnpm typecheck`; throttle unit tests pass.
- [ ] `pnpm test:tenancy` against an open-signup staging target — HUMAN (needs server env).
- [ ] Manual: HUMAN — browse/wigolo return 401 with no cookie (devtools, logged-out fetch).

## Manual verification (for the human)

- Mint a v1 key, hammer a list endpoint 130× — expect 429s with `Retry-After`, recovery after a minute.
- Request 9 password resets for one address — 9th+ gets 429, response shape unchanged otherwise.
