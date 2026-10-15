# Access Control Security Report

## Status: PASS

## Findings

Ownership = storage-key namespacing (`userWsKey`), checked on every read and write; auth and ownership are separate layers (session → user id → namespaced key). New entities verified individually; `v1/equity/*` now validates `stakeholderId` exists on the same cap table (was: any string accepted → orphan records). Tenancy suite extended this pass: new-entity seeds/reads/writes, dedicated-route cross-tenant refusal (accept/payroll/receive), v1 key scoping + revocation.

## What's at risk

Cross-tenant reads/writes via guessed workspace ids. Blocked by construction + live tests.

## What's already secure

`wsAllowed` key scoping, uniform webhook 401s, operator-only shared secrets, API-key/workspace intersection on mint.

## Recommendations

1. Run `pnpm test:tenancy` against staging before releases (needs open-signup target).
