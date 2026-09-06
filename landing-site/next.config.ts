import path from 'node:path';
import type { NextConfig } from 'next';

// GitHub Pages serves project sites from https://<user>.github.io/<repo>/, so
// every asset and internal link needs that repo-name prefix baked in at build
// time. The deploy workflow sets BASE_PATH to "/<repo>"; a custom domain (a
// CNAME file, or the user org/personal pages repo) needs no prefix, so this
// defaults to empty for local dev and any other host.
const basePath = process.env.BASE_PATH || '';

const nextConfig: NextConfig = {
  output: 'export',
  basePath,
  assetPrefix: basePath || undefined,
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  // Next.js infers the project root by walking up for the *outermost*
  // lockfile, which lands on the main app's pnpm-lock.yaml one directory up
  // and pulls its root-level proxy.ts (session-auth middleware, importing
  // modules that don't exist in this standalone static site) into the build.
  // Pin the root explicitly so this project never resolves anything outside
  // its own directory.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
