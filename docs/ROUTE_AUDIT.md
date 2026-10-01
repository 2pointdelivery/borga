# Route audit (T13), 2026-10-01

Scope: every handler under `app/api/**`. Question asked of each: who can call it, whose data or credentials does it touch, and what is the worst a signed-in stranger could do.

## How access is enforced

- `proxy.ts` gates every `/api/borga/**` request on a valid signed session cookie, and requires the `X-Borga-Client` header (CSRF) on writes. Exemptions are listed in the file and are each authenticated another way (see "Public by design").
- Most routes also re-check the session themselves with `sessionUserId(req)` and scope data under `u::<user>::ws::<ws>::…`.
- `/api/auth/*` and `/api/diag` are outside the session gate by necessity; they are now rate limited (below).

## Fixed in this pass

| Route | Problem | Fix |
|---|---|---|
| `browse` | SSRF: hostname text match only, redirects followed. A public page could redirect to `http://169.254.169.254/` or a DNS name could point at an internal IP, and the response body came back to the caller. Unbounded response size. | `fetchPublic` in `lib/borga/safe-url.ts` resolves DNS and re-checks every redirect hop; body capped at 1.5 MB. Tests in `lib/ssrf.test.ts`. |
| `smtp-test` | Any signed-in user could send mail to any address through the shared SMTP account (spam relay, sender-reputation damage). | Test mail goes only to the caller's own account address; session re-checked. |
| `/api/auth/*`, `/api/diag` | No rate limit at all (outside the proxy matcher): password brute force, signup and reset-email spam, log flooding. | 10 POSTs per minute per IP per route (30 for `diag`), then 429. Verified: attempts 11 and 12 return 429. |

## Public by design (no session), and how each is authenticated

| Route | Authentication |
|---|---|
| `hooks/[provider]` | Provider HMAC signature (Meta, Twilio) against the tenant's stored credentials |
| `tickets/inbound` | Per-workspace inbound token, constant-time compare |
| `webhooks/inbound` | Bearer token or webhook HMAC, checked in the route |
| `voice/call/twiml`, `voice/call/audio` | Signed server-generated id (`verifyPayloadSignature`) |
| `email/unsubscribe` | Signed token in the URL |
| `cron` | `Authorization: Bearer $CRON_SECRET` (answers 401 when unset) |
| `health` | None; returns only database connectivity |
| `mcp/oauth/callback` | Single-use random state, 10 minute expiry, PKCE; userId and workspace come from the stored state record |

## Open: needs a decision or a larger change

| # | Finding | Risk | Resolution path |
|---|---|---|---|
| 1 | `config` GET/POST: any signed-in user can set or delete the deployment-wide API keys (LLM, SMTP, Twilio, ElevenLabs, …). | Critical in any multi-user deployment | T11: operator-only (`BORGA_OPERATOR_EMAILS`) plus `SIGNUP_MODE` |
| 2 | Shared deployment-wide keys are used by `composio`, `elevenlabs`, `voice/tts`, `voice/stt`, `voice/call` (Twilio), `whatsapp`, `wigolo`. Any signed-in user spends them. `composio` also lists all connected accounts of the shared project (`/connectedAccounts?limit=50`) and accepts a caller-chosen `entityId` and `connectionId`, so with more than one tenant it exposes other tenants' connected accounts. | High with several tenants; acceptable if every user belongs to one organisation | T10 tenancy decision. Recommended: invite-only signup for launch (all users are one organisation). Per-workspace keys (the Connections store) are the route to real multi-tenancy; Phase 4 does this for Twilio. |
| 3 | `whatsapp` reads and writes its config at `scopedKey(ws, 'whatsapp')`, the legacy un-prefixed key `ws::<ws>::whatsapp`, not under `u::<user>::ws::<ws>::`. Different keyspace from the dashboard, and addressable by anyone who knows a workspace id. | Medium | Move to `userWsKey` with `sessionUserId` when WhatsApp is made real (Phase 3); keep the feature off in production until then |
| 4 | `voice/call` can place calls to any number with the shared Twilio account. | Medium (toll fraud) | Same as 2; plus restrict destinations to allowed countries (USA, Canada, Ghana) in Phase 4 |
| 5 | `mcp/oauth/callback` does not check that the signed-in user equals `record.userId`. State is an unguessable single-use secret, so this is defence in depth only. | Low | Add the comparison |
| 6 | `browse` and `fetchPublic` resolve DNS and then `fetch()` resolves again, so DNS rebinding between the two is not blocked. | Low | Keep the host firewall closed to internal services (second layer); pin the resolved address if it ever matters |
| 7 | The rate limiter is in memory per process. Fine for the single-instance Oracle deployment; wrong if scaled out. | Low | Move to the database or a proxy-level limit if scaled out |

## Routes already checking the session and scoping by user

`agent/run`, `chat`, `connections`, `data`, `email`, `engine`, `features`, `llm-test`, `mcp`, `memory`, `orchestrate`, `probe`, `scheduler`, `supermemory`, `sync`, `tickets`, `webhooks/dispatch`, `auth/me`. Spot-checked: each derives the user id from the verified cookie, never from the request body.
