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

## Update: tenancy decision and operator-only config (T10, T11)

Decision: launch as **one organisation with invite-only signup**. All signed-in users then belong to the same company, so the shared deployment-wide keys in open finding 2 are not a cross-tenant leak. Real multi-tenancy needs per-workspace keys first (Connections store; Phase 4 does this for Twilio).

| Finding | Status |
|---|---|
| 1 `config` writable by any user | **Fixed.** POST needs a deployment operator (`BORGA_OPERATOR_EMAILS`); other users get 403. GET still tells everyone whether a provider is configured, but the masked value is hidden from non-operators. |
| 2 shared keys spent by any signed-in user | **Mitigated by the tenancy decision.** `SIGNUP_MODE` defaults to `invite` in production: an operator issues a single-use code bound to the invitee's email (7 day expiry, only its hash stored, atomic single-use claim, revocable). `closed` refuses all signups except listed operators; `open` is allowed but the server warns at start. Still open if you ever run `open`: any signup can spend the shared keys. |

Verified end to end on a production build (throwaway accounts, removed afterwards): stranger refused; operator can always sign up; invite works only for its email; reuse refused; two simultaneous signups with one code gave one success; revoked invite refused; a non-operator cannot read masked keys, change keys or issue invites.

Known and accepted: probing an operator's own email on the signup form returns 409 (operators bypass the signup mode so the owner can always bootstrap), which reveals that an administrator email has an account.

## Added later: chat paths and editable provider URLs

| # | Finding | Risk | Resolution path |
|---|---|---|---|
| 8 | `chat`, `llm-test` and agent runs send the shared provider API key to the base URL stored in the workspace catalog, which any signed-in user can edit (Advanced: edit the model catalog). A user could point a provider at their own server and receive the shared key. | Low under the one-organisation, invite-only model; High if untrusted users can sign up | Use the built-in base URL for the known providers and allow a custom URL only for `llm-custom`/`llm-ollama` (which never receive a shared provider key). The new `llm-models` route already does this. |

## Update: cross-tenant test suite (T12) and the WhatsApp fix

`scripts/tenancy.test.mjs` (`pnpm test:tenancy`, 9 tests) runs against a live server and database. It creates two real users; user A seeds data through the real routes (goals, knowledge, WhatsApp state, a ticket, a feature override, email settings, a memory, a scheduled task, a saved connection secret); user B then calls every session route that takes a workspace id (data, tickets, features, email, connections, memory, scheduler, whatsapp, supermemory, engine, sync) with A's workspace id and A's user id in the query, and writes into A's workspace id. It checks that B never sees A's data, nothing B writes reaches A, B cannot open, edit or comment on A's ticket, public endpoints refuse B's credentials against A's workspace, non-operators cannot change shared secrets, and no route answers without a session. It deletes its two users afterwards. To run it the target must allow open signup and not list the test users as operators (for example a production build started with `SIGNUP_MODE=open BORGA_OPERATOR_EMAILS=nobody@example.test`). It is **not yet in CI** because that needs a MySQL service and a running server.

Verified: 9 of 9 pass on the fixed code. With the old WhatsApp route restored, exactly the two WhatsApp checks fail (below), so the suite is not vacuous. Isolation on the other routes holds by construction: every session route takes the user id from the signed cookie and builds storage keys from it, so another user's workspace id points into the caller's own empty space.

Fixed in this pass (finding 3 above, and two more found while writing the suite):
- `whatsapp` stored its state under an un-prefixed key. It now uses the signed-in user's own workspace key, the one the dashboard reads (previously the connected state the route saved never reached the dashboard), requires a session, and honours the per-workspace feature flag.
- `whatsapp` `configure` with `persistKey` wrote the deployment-wide `WHATSAPP_ACCESS_TOKEN` for any signed-in user, bypassing the operator-only lock on `config`. It now requires an operator.
- `memory` and `scheduler` fell back to a shared un-prefixed key when the user id was missing. They now answer 401 (the proxy already prevented this; it is defence in depth).

Open item 3 is closed. Items 1 and 2 are unchanged from the earlier update.
