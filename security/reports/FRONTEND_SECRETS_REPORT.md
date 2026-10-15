# Frontend Secrets Security Report

## Status: PASS

## Findings

Zero `fetch("https://` in `components/` — all third-party calls proxy through `/api/borga/*` server routes with server-side keys. No hardcoded secrets in client code (only env-var names as labels). No `productionBrowserSourceMaps`/`devtool` overrides; `.next/static` contains zero `.js.map` files. Residual: workspace Composio keys mirrored in `localStorage` by design (offline mode), mitigated by CSP + `[stored server-side]` masking.

## What's at risk

XSS could exfiltrate mirrored keys — accepted trade-off, contained by CSP nonces (this pass) and HttpOnly sessions.

## What's already secure

Server-side egress only, masked-secret flow, no public sourcemaps.

## Recommendations

1. Never set `productionBrowserSourceMaps: true`; prefer server-held keys for shared machines.
