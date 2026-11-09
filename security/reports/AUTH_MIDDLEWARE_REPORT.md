# Auth Middleware Security Report

## Status: PASS

## Findings

76 route files enumerated: every `/api/borga/*` is behind the proxy session gate or a deliberate exemption with in-route auth (webhook HMACs, `CRON_SECRET`, signed tokens, OAuth state); every `/api/v1/*` calls `guardV1` (session or `borga_` key + `?ws=` scope + feature gate). Two routes were proxy-only (`browse` POST, `wigolo` GET) — fixed this pass by adding in-handler `sessionUserId` checks (`app/api/borga/browse/route.ts`, `app/api/borga/wigolo/route.ts`), so serving without the proxy stays safe.

## What's at risk

An unauthenticated fetch proxy (`browse`) or deployment-detail disclosure (`wigolo`). Both now double-gated.

## What's already secure

Two-layer pattern (proxy + handler), uniform-401 webhooks, Stripe/cron timing-safe auth, operator-only config, session-only key minting.

## Recommendations

1. Keep in-handler checks on every new route even when the proxy gates it (checklist for new routes).
