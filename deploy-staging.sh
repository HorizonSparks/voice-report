#!/bin/bash
# ============================================================
# Voice Report — Staging deploy script
# Builds + deploys against the staging environment so risky changes
# can be exercised before touching production. Mirror of deploy.sh
# but targeting the staging container + DB.
#
# Prerequisites (one-time setup):
#   1. Create the staging DB on the shared Postgres container:
#        docker exec postgress_horizonsparks psql -U horizon_spark -d postgres \
#          -c "CREATE DATABASE horizon_staging OWNER horizon_spark;"
#      Then apply the schema:
#        docker exec -i postgress_horizonsparks psql -U horizon_spark -d horizon_staging < database/postgres-schema.sql
#      And every migration in database/migrations/ in order.
#   2. Copy .env to .env.staging, then change:
#        PG_DATABASE=horizon_staging
#        KEYCLOAK_ISSUER=https://keycloak.horizonsparks.ai/realms/app-staging  (or a staging realm)
#        STRIPE_API_KEY=sk_test_...  (Stripe TEST mode keys)
#        STRIPE_WEBHOOK_SECRET=whsec_...  (Stripe TEST mode webhook)
#        PUBLIC_BASE_URL=https://staging.horizonsparks.com
#        SUPPORT_TIMEZONE=America/Mexico_City
#   3. Point a DNS record at this host for staging.horizonsparks.com.
#
# Then `bash deploy-staging.sh` from any branch you want to test.
# ============================================================

set -e
cd /home/horizonsparks/voice-report

if [ ! -f .env.staging ]; then
  echo "✗ .env.staging not found. Create it before deploying to staging." >&2
  exit 1
fi

echo ""
echo "=========================================="
echo "  STAGING DEPLOY — Voice Report"
echo "  Branch: $(git rev-parse --abbrev-ref HEAD)"
echo "  Commit: $(git rev-parse --short HEAD)"
echo "=========================================="

# Step 1: Bump service worker cache
echo ""
echo "[1/5] Bumping service worker cache..."
if [ -f client/public/sw.js ]; then
  sed -i "s/voice-report-v[0-9]*/voice-report-v$(date +%s)/" client/public/sw.js
  echo "  ✓ Cache version bumped"
fi

# Step 2: Build staging image
echo ""
echo "[2/5] Building staging docker image..."
BUILD_LOG=$(mktemp)
if docker compose -f docker-compose.yml -f docker-compose.staging.yml build app > "$BUILD_LOG" 2>&1; then
  echo "  ✓ Build successful"
else
  echo "  ✗ BUILD FAILED — last 30 lines:"
  tail -30 "$BUILD_LOG"
  rm -f "$BUILD_LOG"
  exit 1
fi
rm -f "$BUILD_LOG"

# Step 3: Recreate staging container
echo ""
echo "[3/5] Recreating staging container..."
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d app > /dev/null 2>&1
echo "  ✓ Container recreated"

# Step 4: Wait + check boot logs
echo ""
echo "[4/5] Waiting for boot + checking server errors..."
sleep 6
CONTAINER_STATE=$(docker inspect -f '{{.State.Status}}' voice-report-staging-app-1 2>/dev/null || echo 'missing')
if [ "$CONTAINER_STATE" != "running" ]; then
  echo "  ✗ Container is not running (state: $CONTAINER_STATE)"
  docker logs voice-report-staging-app-1 --tail 30 2>&1
  exit 1
fi

ERROR_LOG=$(docker logs voice-report-staging-app-1 --tail 60 2>&1 | grep -iE 'FATAL|SyntaxError|Cannot find module|MODULE_NOT_FOUND|ENOENT|UnhandledPromiseRejection' | head -10 || true)
if [ -n "$ERROR_LOG" ]; then
  echo "  ✗ SERVER ERRORS DETECTED:"
  echo "$ERROR_LOG"
  exit 1
else
  echo "  ✓ No server errors"
fi

# Step 5: Health check (no PIN auth assertion — staging may have empty seed data)
echo ""
echo "[5/5] Health check..."
STAGING_PORT="${STAGING_PORT:-3071}"
HEALTH_CODE=$(curl -sk -o /dev/null -w '%{http_code}' "http://localhost:$STAGING_PORT/api/me" 2>/dev/null || echo '000')
# /api/me with no session returns 200 with auth:null — proves the server is up
if [ "$HEALTH_CODE" = "200" ] || [ "$HEALTH_CODE" = "401" ]; then
  echo "  ✓ Server responding on port $STAGING_PORT (HTTP $HEALTH_CODE)"
else
  echo "  ✗ Server not responding (HTTP $HEALTH_CODE)"
  exit 1
fi

echo ""
echo "=========================================="
echo "  ✅ STAGING DEPLOY COMPLETE"
echo "  Test at: https://staging.horizonsparks.com"
echo "=========================================="
