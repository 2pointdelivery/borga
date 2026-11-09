# Dependencies Security Report

## Status: PASS

## Findings

`pnpm-lock.yaml` committed, frozen installs in Docker (verified working post-change). **This pass:** all `dependencies` + `devDependencies` pinned exact (was: 29 caret) — `pnpm install --lockfile-only` regenerated a consistent lockfile; `pnpm install --frozen-lockfile --offline` verified. `pnpm audit --prod`: **zero vulnerabilities**. Dev-only residue (electron-builder http-cache-semantics/sprintf-js, drizzle-kit esbuild, eslint braces) unchanged, non-shipping.

## What's at risk

Supply-chain drift on update, known CVEs in shipped code. Both closed for prod.

## What's already secure

Lockfile discipline, `pnpm.overrides` CVE hygiene, prod audit gate.

## Recommendations

1. Keep `pnpm audit --prod` blocking in CI; track electron-builder/drizzle-kit upstream fixes for dev-only items.
2. Any `pnpm update` must keep exact pins (no `^` reintroduction).
