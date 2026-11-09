# SSRF Security Report

## Status: PASS (1 critical hole fixed this pass)

## Findings

`lib/borga/safe-url.ts` guard is solid (DNS-resolve + private-range refuse on every redirect hop, 1.5 MB cap, known TOCTOU documented). **Fixed:** `fetchFundingPage` (`lib/borga/fundraising-pipeline.ts`) used a hostname regex + blind-redirect `fetch` — reachable from the Fundraising tab and agent tools. Now routes through `fetchPublic({allowHttp:true})` + `readTextCapped`. **Fixed:** workspace-catalog LLM base URLs could steer shared provider keys at attacker servers — `resolveProviderConfig` now pins every hosted provider to its built-in URL; only `llm-custom`/`llm-muse` accept custom endpoints (Muse asserted at call time). EDGAR comps use a hardcoded host (ticker→CIK map only). Webhook delivery is https-only, no redirects.

## What's at risk

Server-side requests to cloud metadata / internal services with leaked keys. Closed at every user-influenced call site.

## What's already secure

`fetchPublic` everywhere else (browse, engine incl. paginated links, llm-models, SMTP dial-to-checked-IP).

## Recommendations

1. Keep host firewall closed to internal services (second layer for the documented DNS-rebinding TOCTOU).
2. Verify `BORGA_ALLOW_PRIVATE_ENGINE` is unset in production.
