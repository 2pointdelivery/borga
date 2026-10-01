# Supermemory (optional long-term AI memory)

Adds semantic recall to Borga's agents using [Supermemory](https://supermemory.ai). It is **off by default**, because it sends data to a third party. Borga's own stores stay the source of truth; Supermemory only adds retrieval. If it is off, slow or down, everything works exactly as before.

## Turn it on
1. **Key:** Integrations → Connections → *Supermemory* (per company, encrypted) or set `SUPERMEMORY_API_KEY` on the server (shared by all companies). Press **Test connection**.
2. **Flag:** Settings → Features → *Supermemory* (operators can force it off with `BORGA_FEATURES_OFF=supermemory`).
3. **Choose what may leave:** Knowledge Base → *Long-term AI memory* card. Four switches: agent memory, knowledge base, resolved tickets (**off by default**), company profile.

## What it does
| Phase | Behaviour | Where |
|---|---|---|
| Agent memory | Every stored memory is mirrored (`taskType: memory`, `customId: mem:<id>`). Before a run, relevant facts are recalled with `/v4/search` and added to the prompt under "recalled from long-term memory" (de-duplicated against the agent's own memories, so agents also learn what *other* agents recorded). Deleting a memory in Borga deletes the remote copy. | `supermemory-mirror.ts`, `agent-context.ts`, `memory/route.ts`, `tools.ts` |
| Knowledge base | Entries are indexed (`superrag`, `kb:<id>`), synced every 10 min and via **Sync now**; only new/changed entries are sent, removed ones are deleted. Once the KB has more than 12 entries, prompts and chat use the top retrieved passages instead of every entry; `search_knowledge` becomes semantic (falls back to substring search). | `supermemory-sync.ts`, `supermemory-context.ts`, `chat/route.ts` |
| Company profile | Standing facts from `/v4/profile` (cached 5 min) are added to agent prompts. The card has a **What it knows** preview. | `supermemory.ts` |
| Support Desk | Resolved/closed tickets are indexed (`ticket:<KEY>`); reopening removes them. The ticket sheet shows **Similar resolved tickets**; agents get `find_similar_tickets` and are told to call it before `draft_ticket_reply`. | `tickets-server.ts`, `TicketDetailSheet.tsx` |

## Privacy and safety
- **One container tag per company** (`borga_<userId>_<workspaceId>`); no cross-tag queries.
- Tickets are sent **without requester name/email**, and addresses inside the text are redacted. Finance, HR and customer records are never sent. Agent memories are whatever agents wrote, so mute that source if agents may record sensitive notes.
- **Delete everything from Supermemory** (card button) removes the company's container; Borga data is untouched.
- Recalled text is injected as background *data*, under the existing rule that stored memories are never instructions.
- All calls are non-throwing with 4-10 s timeouts and a circuit breaker (3 failures → paused for 60 s). Failed writes wait in an outbox and retry with backoff (up to 12 attempts).

## Verification status
- Unit tests: container tags, document shapes, redaction, ranking/dedupe, breaker and backoff (`lib/supermemory.test.ts`).
- Run end to end against a **local fake of the documented API** (shapes from `https://api.supermemory.ai/v4/openapi`): off/on/muted sources send nothing; key and flag changes take effect immediately; memory mirror and delete; KB sync (incremental, removal); retrieval reaching the prompt; cross-agent recall; profile; ticket index/redaction/similar/reopen; outage → outbox → delivered after backoff; purge; auth.
- **Not yet run against the real service.** Run `SUPERMEMORY_API_KEY=… node scripts/smoke-supermemory.mjs` once. It uses a throwaway container and deletes what it creates. Things only the real service can confirm: that re-adding a `customId` after delete behaves as expected, fact-extraction latency, and result ranking.

## Self-hosting / tests
`SUPERMEMORY_BASE_URL` overrides the API base (default `https://api.supermemory.ai`).
