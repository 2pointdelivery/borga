#!/usr/bin/env bash
# Pull the latest code, take a backup first, rebuild and restart.
set -euo pipefail
cd "$(dirname "$0")"
./backup.sh
git -C .. pull --ff-only
docker compose up -d --build
docker image prune -f >/dev/null
docker compose ps
# A deploy that does not come up healthy must fail loudly (the app exits at start when its secrets are wrong).
if ! curl -fsS --retry 20 --retry-delay 3 --retry-connrefused -m 10 http://127.0.0.1:13000/api/health >/dev/null; then
  echo "DEPLOY FAILED: /api/health did not answer. See: docker compose logs --tail=80 app" >&2
  exit 1
fi
echo "healthy"
