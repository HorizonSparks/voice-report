#!/bin/bash
# ============================================================
# Voice Report — AWS Deploy & Verify Script
# Mirror of deploy.sh, but uses docker-compose.aws.yml (the prod-tuned
# compose: no inline postgres, PG_HOST=host.docker.internal, no dev-only
# external networks). Run this DIRECTLY on the AWS host.
# ============================================================

set -e
cd /home/ubuntu/production/voice-report

echo ""
echo "=========================================="
echo "  DEPLOY & VERIFY — Voice Report (AWS)"
echo "=========================================="

# Step 1: Bump service worker cache (forces clients to re-fetch)
echo ""
echo "[1/6] Bumping service worker cache..."
if [ -f client/public/sw.js ]; then
  sed -i "s/voice-report-v[0-9]*/voice-report-v$(date +%s)/" client/public/sw.js
  echo "  ✓ Cache version bumped"
else
  echo "  ⚠ client/public/sw.js not found — skipping"
fi

# Step 2: Build docker image (multi-stage; runs vite build inside the build container)
echo ""
echo "[2/6] Building docker image (npm ci + vite build inside container)..."
BUILD_LOG=$(mktemp)
if docker compose -f docker-compose.aws.yml build app > "$BUILD_LOG" 2>&1; then
  echo "  ✓ Build successful"
else
  echo "  ✗ BUILD FAILED — last 30 lines of build log:"
  tail -30 "$BUILD_LOG"
  rm -f "$BUILD_LOG"
  exit 1
fi
rm -f "$BUILD_LOG"

# Step 3: Restart container (docker compose up -d recreates the container with the new image)
echo ""
echo "[3/6] Recreating container..."
docker compose -f docker-compose.aws.yml up -d --force-recreate app > /dev/null 2>&1
echo "  ✓ Container recreated"

# Step 4: Wait for container to come up + check boot logs for FATAL errors
echo ""
echo "[4/6] Waiting for boot + checking server errors..."
sleep 6
CONTAINER_STATE=$(docker inspect -f '{{.State.Status}}' voice-report-app-1 2>/dev/null || echo 'missing')
if [ "$CONTAINER_STATE" != "running" ]; then
  echo "  ✗ Container is not running (state: $CONTAINER_STATE)"
  docker logs voice-report-app-1 --tail 30 2>&1
  exit 1
fi

ERROR_LOG=$(docker logs voice-report-app-1 --tail 60 2>&1 | grep -iE 'FATAL|SyntaxError|Cannot find module|MODULE_NOT_FOUND|ENOENT|UnhandledPromiseRejection' | head -10 || true)
if [ -n "$ERROR_LOG" ]; then
  echo "  ✗ SERVER ERRORS DETECTED:"
  echo "$ERROR_LOG"
  exit 1
else
  echo "  ✓ No server errors"
fi

# Step 5: API health checks (PIN auth — still the primary login path)
echo ""
echo "[5/6] Running API health checks..."
FAIL=0
ADMIN_JAR=/tmp/deploy_admin_cookie.txt
ELLERY_JAR=/tmp/deploy_ellery_cookie.txt

ADMIN_RESP=$(curl -s -c "$ADMIN_JAR" -X POST http://localhost:3070/api/login \
  -H "Content-Type: application/json" \
  -d '{"pin":"12345678"}' 2>/dev/null)

if echo "$ADMIN_RESP" | grep -q '"is_admin":true'; then
  echo "  ✓ Admin login OK"

  REPORT_COUNT=$(curl -s -b "$ADMIN_JAR" http://localhost:3070/api/reports 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  [ "$REPORT_COUNT" -gt 0 ] 2>/dev/null && echo "  ✓ Reports: $REPORT_COUNT" || { echo "  ✗ Reports: EMPTY/ERROR"; FAIL=1; }

  PEOPLE_COUNT=$(curl -s -b "$ADMIN_JAR" http://localhost:3070/api/people 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  [ "$PEOPLE_COUNT" -gt 0 ] 2>/dev/null && echo "  ✓ People: $PEOPLE_COUNT" || { echo "  ✗ People: EMPTY/ERROR"; FAIL=1; }

  # Projects/templates are DATA-state checks (prod runs demo data, 2026-06):
  # an empty table says nothing about the image just deployed. Warn, don't fail
  # — false ✗ on every deploy is how a verify section gets ignored.
  PROJ_COUNT=$(curl -s -b "$ADMIN_JAR" http://localhost:3070/api/projects 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  [ "$PROJ_COUNT" -gt 0 ] 2>/dev/null && echo "  ✓ Projects: $PROJ_COUNT" || echo "  ⚠ Projects: empty (data state, not a deploy failure)"

  TMPL_COUNT=$(curl -s -b "$ADMIN_JAR" http://localhost:3070/api/templates 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(len([t for t in d if 'sparks' in t.get('id','').lower()]))" 2>/dev/null || echo "0")
  [ "$TMPL_COUNT" -gt 0 ] 2>/dev/null && echo "  ✓ Sparks templates: $TMPL_COUNT" || echo "  ⚠ Sparks templates: none for this tenant (data state)"
else
  echo "  ✗ Admin login FAILED"
  FAIL=1
fi

# (2026-06-11) The hardcoded Ellery PIN-1234 check was removed: since the
# 2026-06-08 Keycloak login unification that PIN isn't provisioned in this
# DB, so the check failed on EVERY deploy regardless of the image. The admin
# login above is the auth-path canary; per-user auth now belongs to Keycloak.

rm -f "$ADMIN_JAR" "$ELLERY_JAR"

# Step 6: External health checks (legacy redirect + canonical 200)
echo ""
echo "[6/6] Edge / canonical sanity..."
LEGACY_CODE=$(curl -sk -o /dev/null -w '%{http_code}' https://voice-report.ai/ 2>/dev/null || echo '000')
[ "$LEGACY_CODE" = "301" ] && echo "  ✓ voice-report.ai → 301 redirect live" || echo "  ⚠ voice-report.ai HTTP $LEGACY_CODE (expected 301)"

# horizonsparks.com is served by the SPARK tunnel (see
# reference_production_topology_may31) — its state reflects a different host,
# so it can't fail THIS deploy. Follow redirects; informational only.
CANON_CODE=$(curl -skL -o /dev/null -w '%{http_code}' https://horizonsparks.com/ 2>/dev/null || echo '000')
[ "$CANON_CODE" = "200" ] && echo "  ✓ horizonsparks.com → 200 OK (via Spark tunnel)" || echo "  ⚠ horizonsparks.com HTTP $CANON_CODE (Spark-served — check Spark, not this deploy)"

# Final verdict
echo ""
echo "=========================================="
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ AWS DEPLOY VERIFIED — ALL CHECKS PASSED"
else
  echo "  ❌ AWS DEPLOY FAILED — FIX BEFORE SHIPPING"
fi
echo "=========================================="
echo ""

exit $FAIL
