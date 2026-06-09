#!/usr/bin/env bash
# Build and deploy the Omalyzer web app to omalyzer.com.
#
# Pipeline: vite production build -> S3 (private bucket) -> CloudFront invalidation.
# Static assets are content-hashed and cached immutably for a year; index.html and
# worklet.js are sent no-cache so a new deploy is picked up immediately; .wasm gets
# the application/wasm content-type that streaming instantiation needs.
#
# Usage:   ./deploy.sh
# Requires: aws CLI authenticated for the profile below, and `npm` in web/.
set -euo pipefail

PROFILE="${AWS_PROFILE:-hilsbos}"
BUCKET="omalyzer-web-022103836148"
DIST_ID="E27JEVRT6GNQ6O"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE/web"

echo "==> Building production bundle…"
npm run build

echo "==> Syncing hashed assets (immutable, 1-year cache)…"
aws s3 sync dist/ "s3://$BUCKET/" --delete --profile "$PROFILE" \
  --cache-control "public,max-age=31536000,immutable" \
  --exclude "index.html" --exclude "worklet.js" --no-progress

echo "==> Uploading entry files (no-cache so deploys propagate)…"
aws s3 cp dist/index.html "s3://$BUCKET/index.html" --profile "$PROFILE" \
  --cache-control "no-cache" --content-type "text/html; charset=utf-8" --no-progress
aws s3 cp dist/worklet.js "s3://$BUCKET/worklet.js" --profile "$PROFILE" \
  --cache-control "no-cache" --content-type "text/javascript; charset=utf-8" --no-progress

echo "==> Setting application/wasm content-type…"
for f in dist/assets/*.wasm; do
  aws s3 cp "$f" "s3://$BUCKET/assets/$(basename "$f")" --profile "$PROFILE" \
    --content-type "application/wasm" \
    --cache-control "public,max-age=31536000,immutable" \
    --metadata-directive REPLACE --no-progress
done

echo "==> Invalidating CloudFront cache…"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" \
  --paths "/*" --profile "$PROFILE" \
  --query "Invalidation.{Id:Id,Status:Status}" --output table

echo "==> Done. Live at https://omalyzer.com (edge propagation ~1-2 min)."
