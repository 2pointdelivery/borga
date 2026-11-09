# CSRF Security Report

## Status: PASS

## Findings

Session cookies: HttpOnly, `SameSite=Lax`, `Secure` in secure contexts, HMAC-signed + revocable (`lib/auth/session.ts`, `app/api/auth/login/route.ts:59-65`). All `/api/borga` writes need `X-Borga-Client: borga-dashboard` (or `BORGA_ADMIN_TOKEN` bearer) at the proxy; no CORS origin is ever granted so preflighted cross-site writes fail. No session-authenticated GET mutates state (unsubscribe/twiml/meta-verify GETs are signed-token flows, not cookie flows — CSRF N/A by design).

## What's at risk

Cross-site state changes via cookie-authed requests. Blocked by custom-header + no-CORS combination.

## What's already secure

Cookie flags, write guard, method restriction (GET/POST/OPTIONS on `/api/borga`).

## Recommendations

1. Never add a session-authenticated mutating GET. No `__Host-` prefix yet — revisit if subdomains are ever added.
