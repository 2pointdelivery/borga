# Borga — Voice-First AI Assistant Spec

Source of truth for the Trillion-style rebuild. Written Tier 0, 2026-09-16.

## Identity and intent
- Name: Borga. One line: calm business command-center that gets things done and speaks when needed.
- For: just you (single user; keep per-user state keys in mind anyway).
- First 3 capabilities:
  1. Pipeline follow-ups — review open leads, nudge P0s, create follow-up tasks.
  2. Morning KPI brief — check KPIs/finance across modules, flag below-target.
  3. Inbox drafting — draft customer/lead messages, never send without explicit yes.
- Personality: warm, plain-spoken, brief. Under ~90 words unless detail asked. Greetings/logs say Borga.

## Stack and model
- Language/runtime: keep Next.js 16 App Router + React 19 + TypeScript 5 harness. No new framework; small readable core under `lib/borga/`.
- Brain: latest capable Claude via official API shape, behind thin seam `callLlm`/`resolveLlm` (`lib/borga/agent-context.ts`). Swappable without touching loop.
- Runs: laptop-first (`pnpm dev -p 13000`). Heartbeat kept separable so it can move to always-on host later with no rewrite.

## Voice and boundaries
- Talk: text first (Tier 1-2 must pass in text). Voice = open-mic wake-word kept (`use-voice.ts`, "Borga") + push-to-talk (hold key) to be added Tier 3 for reliability. Wake-word-only single-breath commands supported.
- TTS voice: ElevenLabs "George" (`VR6AewLTigWG4xSOukaG`), stored in config not hardcoded. STT seam defaults to browser recognition now, Deepgram behind same seam later.
- Never without asking: send a message, spend money / move money, delete data, change a setting. Hard confirmation gate Tier 6, per-action, covers typed/voice/heartbeat.
- Proactive: yes, quiet by default. Heartbeat surfaces only when noteworthy; calm held inbox + catch-up on return; quiet hours; kill switch.

## Plan restated
Borga stays on Next.js+TS with Claude behind a seam; first tools serve pipeline, KPI brief, inbox drafts; text loop first, then voice (open-mic kept, push-to-talk added, George voice); heartbeat quiet-by-default with confirmation rails.

## Tier order
Tier 1 brain (text loop) -> Tier 2 hands (tool registry) -> Tier 3 ears/mouth (voice adapters) -> Tier 4 memory -> Tier 5 heartbeat -> Tier 6 rails. One tier verified before the next; voice never forks agent logic.

## Build log (all tiers verified, 2026-09-16)
- Tier 1: `lib/borga/agent-core.ts` (`resolveBrain`/`sendBrainTurn`/`streamBrainTurn`); chat route calls the seam + `?stream=1` SSE. Typecheck + boundaries pass.
- Tier 2: `TOOL_DEFS` (18 tools now) with zod schemas + `needsConfirm` on `composio_action`, `mcp_call`, `run_workflow`; validation errors return to the model, never crash.
- Tier 3: `app/api/borga/voice/stt` (Deepgram, `DEEPGRAM_API_KEY` server-only, 501 fallback to browser recognition); `use-voice.ts` push-to-talk + `interrupt()` barge-in; open-mic kept; George default.
- Tier 4: memory route scoped to user/workspace keys (was global shadow copy); relevance-ranked load (goal hits outrank recency, 25 budget); memory-as-data prompt guard; inspect/edit in Knowledge Base -> Agent memory.
- Tier 5: `heartbeatPaused` kill switch + `quietHours` (22:00-07:00) in settings; `runningSince` overlap guard (15min stale); `ProactiveNotice` held inbox; nextRun persists across restarts; background approvals time out safe.
- Tier 6: `holdForApproval` gate in every mode (threshold from `settings.approvalThresholdUsd`, else 5000); `pendingMcp`/`pendingWorkflow` approvals execute on approve; injection guard (rule 8); per-run audit + ≈cost in activity; kill switch covers webhook inbound.
- Face: `NeedsYouFace` strip on Command Center (approvals inline, notices, heartbeat, today cost).
- Sub-agents: `delegate` tool (4 steps, depth-1 guard, gate still applies inside).
- Always-on: `lib/borga/agent-runner.ts` + `lib/borga/heartbeat.ts` libs; routes are thin callers; `POST /api/borga/cron` with env-only `CRON_SECRET` (see `.env.example`).
- Agent scheduling: `schedule_check` tool (+ `scheduledTasks` in `query_state`) so Borga can promise reminders.

## Going live
1. `pnpm build` green. 2. Set `CRON_SECRET` on the host; point a 5-minute scheduler at `POST /api/borga/cron`. 3. Connect provider + ElevenLabs + Deepgram keys. 4. Live with it a week; tune via the audit trail, not code.
