#!/usr/bin/env bash
# Build and deploy the omalyzer web app to the nine.ch Root CloudVM (Zürich).
#
# Pipeline: wasm build -> vite production build -> rsync dist/ to the box.
# Caddy serves /srv/omalyzer/web directly, so there is no CDN cache to
# invalidate; Caddy sends index.html / worklet.js no-cache (see ../+shushu/setup/Caddyfile)
# so a new deploy is visible immediately, while hashed assets stay immutable.
#
# Usage:   NINE_HOST=<ip-or-host> ./deploy.sh
# Config (env):
#   NINE_HOST   ssh host/IP of the CloudVM            (required)
#   NINE_USER   ssh user that owns the webroot        (default: deploy)
#   WEB_ROOT    path Caddy serves on the box          (default: /srv/omalyzer/web)
#
# (Legacy AWS S3 + CloudFront deploy retired with the nine.ch migration — see
#  ../+shushu. The old recipe lives in git history if ever needed.)
set -euo pipefail

NINE_HOST="${NINE_HOST:?set NINE_HOST to the CloudVM ssh host/IP}"
NINE_USER="${NINE_USER:-deploy}"
WEB_ROOT="${WEB_ROOT:-/srv/omalyzer/web}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE/web"

echo "==> Building the WASM core (omalyzer-wasm)…"
npm run wasm

echo "==> Building production bundle…"
npm run build

echo "==> Syncing dist/ → ${NINE_USER}@${NINE_HOST}:${WEB_ROOT} …"
# -z compress; --delete prunes superseded hashed assets; only changed files ship.
rsync -az --human-readable --delete \
  dist/ "${NINE_USER}@${NINE_HOST}:${WEB_ROOT}/"

echo "==> Done. Live at https://omalyzer.com (Caddy serves immediately)."
