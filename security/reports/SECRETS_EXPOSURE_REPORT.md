# Secrets Exposure Security Report

## Status: PASS

## Findings

`.gitignore` ignores `.env`/`.env.*` (keeps `.env.example`); `git ls-files .env` is empty — only `.env.example` is tracked. Grep for `sk_live_/sk_test_/AKIA/ghp_/AIza` hits only test fixtures (`lib/billing.test.ts`), validators (`lib/borga/boot-checks.ts`), and UI hint text — no real secrets in source. `.env.example` holds placeholders only. All 17 `NEXT_PUBLIC_*` usages are analytics IDs/URLs. Dockerfile never copies `.env` (`.dockerignore` excludes it; runner copies only build output). `public/` is empty. One local hygiene note: `backups/borga-dev-before-migrations-*.sql` (300 KB) sits on dev disk, untracked and unserved.

## What's at risk

A leaked `.env` or DB dump exposes `SESSION_SECRET`, `DATABASE_URL`, provider keys. Current controls keep them out of git and the image.

## What's already secure

Gitignore + frozen-lockfile Docker build + boot-time secret validation (`lib/borga/boot-checks.ts` refuses weak/missing secrets in production).

## Recommendations

1. Rotate/delete local `backups/*.sql` dumps or encrypt at rest (LOW).
2. Add `gitleaks` pre-commit (defense in depth).
