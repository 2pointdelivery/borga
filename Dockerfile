FROM node:22-slim AS builder
WORKDIR /app
ENV CI=true NEXT_TELEMETRY_DISABLED=1
# Build-time placeholder only (next build imports every route; the pool connects lazily). Not in the runtime stage.
ENV DATABASE_URL=mysql://build:build@127.0.0.1:3306/build
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
COPY . .
RUN pnpm install --frozen-lockfile && pnpm run build && (test -d public || mkdir public)

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
# Database migrations and the script that applies them (run by the "migrate" service in deploy/docker-compose.yml).
COPY --from=builder /app/drizzle ./drizzle
# Country, state and city lists for the address dropdowns (GeoNames, CC BY 4.0).
COPY --from=builder /app/data ./data
COPY --from=builder /app/scripts/migrate.mjs /app/scripts/migrate-core.mjs ./scripts/
RUN pnpm install --frozen-lockfile --prod && chown -R node:node /app
# Secrets (DATABASE_URL, SMTP_*, CRON_SECRET, ...) come from the host's environment, never from the image.
USER node
EXPOSE 13000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:13000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Run next directly: "pnpm start" would need corepack to resolve pnpm again at runtime, as the unprivileged user, and fail offline.
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "13000"]
