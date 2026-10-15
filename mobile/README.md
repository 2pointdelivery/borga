# Borga Mobile (Expo — native rebuild, phases 1–5)

Native iOS + Android client for the Borga Next.js server in this repo.
Status: app code complete (all 11 modules), `expo-doctor` 18/18 clean,
Android JS bundle + native project verified. Only hosted binary signing
needs your accounts (see Bottom).

## What works (all live against your API, not mocks)

- Auth: login/signup/me/logout (`/api/auth/*`, same users as web)
- Workspace switcher (`GET /api/borga/data` → per-ws `GET /api/borga/data?ws=`)
- Overview: KPIs, tasks, leads, invoices, agents
- Sales: pipeline stages, add lead, customers, invoices
- Marketing: ads spend/ROAS, posts, save draft
- Comms: unified inbox + Ask Borga AI (`POST /api/borga/chat`)
- Support: tickets list/refresh/create (`/api/borga/tickets?ws=`)
- Finance: P&L totals, ledger, journals, bank, invoices/bills
- HR: directory, time-off list, request leave
- Company: workspaces, fundraising, KB list, add note
- AI Platform: agents, task queue, recent runs
- Integrations: connections, Composio toolkits, MCP (status; OAuth stays web-only)
- Settings: backend URL, feature/billing readout (toggles stay web-only)

## Run (same Wi-Fi)

```bash
cd mobile
npm install
npx expo start          # scan QR with Expo Go
```

Backend default `http://10.0.0.170:13000` (`app.json → extra.apiBaseUrlDefault`,
editable in-app). `android:usesCleartextTraffic` is set via `expo-build-properties`
(verified in `android/app/src/main/AndroidManifest.xml`), so HTTP works for local testing.
Allow inbound TCP 13000 in Windows Firewall.

## Verified on this machine

- `npx tsc --noEmit` — clean
- `npx expo-doctor` — 18/18 passed
- `npx expo export --platform android` — bundle OK (~1.6 MB, 563 modules, `dist/`)
- `npx expo prebuild --platform android` — `android/` native project generated

## Builds → downloads (EAS cloud; Windows can't build iOS locally)

```bash
cd mobile
npm install -g eas-cli        # global, NOT a project dep
eas login                       # free Expo account
eas init                        # fills extra.eas.projectId in app.json
eas build --platform android --profile preview     # → .apk download link (testers)
eas build --platform android --profile production  # → .aab → Play Console (internal track)
eas build --platform ios --profile production      # → TestFlight / App Store via eas submit
```

Or: GitHub Actions → `mobile-build` workflow (needs `EXPO_TOKEN` secret).

## Status (2026-10-13)

- EAS project: `@ansah-group/borga-mobile` (`c228f8cf-3232-4890-8839-a21270d8015e`)
- Preview APK build: https://expo.dev/accounts/ansah-group/projects/borga-mobile/builds/ee15f0da-55a0-4c87-90f9-68f3b32efb76
- Production AAB build: https://expo.dev/accounts/ansah-group/projects/borga-mobile/builds/caf48994-7814-48b7-ac9f-d8bb9d75e9c8
- Download the `.apk` / `.aab` from those pages once status shows Finished.

## Still needed from you (ONLY remaining blockers)
- [ ] Custom branding if wanted (now: name `Borga`, `com.comprun.borga`, dark + blue
      generated icons at store sizes — `scripts/gen-icons.js` regenerates them)
- [ ] Apple Team ID + App Store Connect key (iOS signing; fill `eas.json → submit`)
- [ ] `play-service-account.json` (Android auto-submit; optional — manual AAB upload works)
- [ ] Public HTTPS backend before any store submission (App Store rejects `http://10.0.0.170`)
