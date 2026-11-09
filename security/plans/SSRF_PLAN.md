# SSRF Fix Plan — implemented

## Changes

- `lib/borga/fundraising-pipeline.ts` — `fetchFundingPage` now uses `fetchPublic({allowHttp:true})` + `readTextCapped` (DNS-checked every hop, no blind redirects).
- `lib/borga/llm-providers.ts` — `resolveProviderConfig` pins hosted providers to built-in base URLs; only `llm-custom`/`llm-muse` accept custom endpoints.

## New files

- None.

## Verification goals

- [x] `pnpm typecheck` clean; fundraising + model tests pass.
- [x] No raw `fetch(userUrl)` remains at user-influenced call sites (grep).
- [ ] Manual: HUMAN — save a bogus catalog URL for a known provider, confirm chat still hits the real provider host (network log).

## Manual verification (for the human)

- Try adding a funding URL of `http://169.254.169.254/` — expect a clean refusal, no hang.
