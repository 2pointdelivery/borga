#!/usr/bin/env bash
# Pull the latest code, take a backup first, rebuild and restart.
set -euo pipefail
cd "$(dirname "$0")"
./backup.sh
git -C .. pull --ff-only
docker compose up -d --build
docker image prune -f >/dev/null
docker compose ps
