# XSS + Error-Handling Fix Plan — implemented

## Changes

- `lib/borga/report-template.ts` — `logoDataUrl` allowlisted (`data:image/...;base64`, ≤700 KB) with initials fallback; hex-only colors; escaped initials; `csvSafe` defusing in `csvWithHeader`; `brandedDocHtml` trusted-markup contract documented.
- `app/app/error.tsx` — stack trace development-only.
- `app/api/v1/tickets/route.ts`, `app/api/borga/invoice-pay/route.ts` — generic 500/502 + server-side log.
- `app/api/borga/voice/stt/route.ts` — `audio/*` MIME allowlist.
- `lib/auth/password.ts` — pinned scrypt params (identical to defaults; old hashes verify).

## New files

- None.

## Verification goals

- [x] `pnpm typecheck`; billing/statement/website tests pass.
- [ ] Manual: HUMAN — set company logo to `x" onerror="alert(1)` text and print an invoice (renders initials, no image, no alert); export a CSV with a `=cmd` vendor name (opens defused).

## Manual verification (for the human)

- Trigger an app error in production build — page shows message only, no stack; `/api/diag` still receives the stack server-side.
