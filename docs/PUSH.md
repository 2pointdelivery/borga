# Browser push (Phase 1)

Self-hosted Web Push (VAPID) — no OneSignal, no Firebase. Urgent and
noteworthy notices reach subscribed devices even with the dashboard closed;
info stays in the app.

## Setup (one time per deployment)

```bash
npx web-push generate-vapid-keys
```

Put the output in `.env` (see `.env.example`):

```ini
VAPID_PUBLIC_KEY=…
VAPID_PRIVATE_KEY=…
VAPID_SUBJECT=mailto:ops@example.com
```

Without keys the app runs normally and boot logs one warning; the
Notifications bell and Settings → Notifications explain that push is off.

## How it works

- The service worker (`public/sw.js`, no caching, tray only) renders pushes
  and focuses/opens `/app` on tap. Repeat pushes for one notice collapse by
  tag (`borga-<notice-id>`).
- Subscribing (bell → Notify me, or Settings → Notifications → Notify this
  device) stores the endpoint under the user+workspace
  (`pushSubscriptions`, max 20 devices, deduped by endpoint).
- Producers (`addNotice`, the SLA sweep) fan out through
  `push-server.ts`, gated by workspace prefs (`pushUrgent`,
  `pushNoteworthy`, both default on) and the subscription list.
- Sends that come back 404/410 prune the dead endpoint automatically.
- `POST /api/borga/push` `test` performs one real delivery and reports
  `{ sent }` honestly — use Settings → Send test after enabling.

## What it does not do

- No rich actions, images, or per-notice deep links beyond opening the
  dashboard (precise navigation lives in the in-app bell: a run opens
  Runs & Queue, a task opens the Planner).
- No SMS/Slack/Teams channels — push + email only (see the Phase 1 plan).
- Test in production with a real device once: desktop Chrome and Android
  Chrome work; iOS needs the app installed to the home screen (Web Push on
  iOS 16.4+).
