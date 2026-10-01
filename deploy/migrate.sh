#!/usr/bin/env bash
# Apply (or preview) database migrations by hand. The stack already does this on every "docker compose up".
#   ./migrate.sh             apply pending migrations
#   ./migrate.sh --dry-run   show what would run, change nothing
# Back up first (./backup.sh): MySQL cannot roll a half-applied schema change back.
set -euo pipefail
cd "$(dirname "$0")"
docker compose run --rm migrate node scripts/migrate.mjs "$@"
