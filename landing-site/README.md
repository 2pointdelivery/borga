# Borga landing page (static, GitHub Pages)

A standalone copy of the marketing landing page (`components/landing/Landing.tsx` in the main
app), built as a static export for GitHub Pages. It is intentionally separate from the main
Borga app: that app is a dynamic, session-authenticated, database-backed Next.js server (API
routes, `proxy.ts` auth middleware, MySQL) and cannot run on GitHub Pages, which only serves
static files. This project has no dependency on any of that — it's pure marketing copy.

## Local dev

```bash
pnpm install --ignore-workspace   # this folder is intentionally NOT a pnpm workspace member —
                                   # it needs its own lockfile, isolated from the main app's deps
pnpm dev                          # http://localhost:13100
```

(An `.npmrc` with `ignore-workspace=true` is already checked in, so a plain `pnpm install` works
too — the flag above is only needed if you ever remove it.)

## Build

```bash
pnpm build      # static export -> out/
```

`NEXT_PUBLIC_APP_URL` controls where "Sign in" / "Get started" link to (the real deployed app).
It defaults to a placeholder — set it before building for production:

```bash
NEXT_PUBLIC_APP_URL=https://app.yourdomain.com pnpm build
```

`BASE_PATH` sets a path prefix (e.g. `/borga` for a GitHub Pages project site served at
`https://<user>.github.io/borga/`). Leave unset for a custom domain or a user/org root page.

## Deploying to GitHub Pages

Handled by `.github/workflows/deploy-landing.yml` — pushes to `main` that touch `landing-site/**`
build and publish it automatically via GitHub's official Pages actions. One-time setup:

1. In the repo: **Settings → Pages → Source → GitHub Actions**.
2. Optional: **Settings → Secrets and variables → Actions → Variables**, add `APP_URL` set to
   the real app's deployed origin (otherwise the site links to a placeholder).
3. Optional custom domain: **Settings → Pages → Custom domain**, and add a `public/CNAME` file
   here with that domain (GitHub Pages requires the CNAME file in the published output; the
   workflow copies whatever `next build` static-exports, so drop a `CNAME` next to `app/` and add
   it to the export by placing it under `public/` — Next's static export copies `public/` verbatim
   into `out/`).

To trigger a deploy without a code change, run the workflow manually from the Actions tab
(`workflow_dispatch`).
