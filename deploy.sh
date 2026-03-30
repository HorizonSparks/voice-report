#!/bin/bash
# ============================================================
# Voice Report — Deploy & Verify Script
# Run this after every change. Do NOT tell the user "it's done"
# unless this script passes.
# ============================================================

set -e
export PATH=/home/horizonsparks/.nvm/versions/node/v22.22.2/bin:$PATH
cd /home/horizonsparks/voice-report

echo ""
echo "=========================================="
echo "  DEPLOY & VERIFY — Voice Report"
echo "=========================================="

# Step 1: Bump service worker cache
echo ""
echo "[1/6] Bumping service worker cache..."
sed -i "s/voice-report-v[0-9]*/voice-report-v$(date +%s)/" client/public/sw.js
echo "  ✓ Cache version bumped"

# Step 2: Build
echo ""
echo "[2/6] Building with Vite..."
BUILD_OUTPUT=$(npx vite build 2>&1)
if echo "$BUILD_OUTPUT" | grep -q "built"; then
  echo "  ✓ Build successful"
else
  echo "  ✗ BUILD FAILED"
  echo "$BUILD_OUTPUT"
  exit 1
fi

# Step 3: Restart PM2
echo ""
echo "[3/6] Restarting PM2..."
npx pm2 restart voice-report --silent 2>/dev/null
sleep 3
echo "  ✓ PM2 restarted"

# Step 4: Check PM2 logs for errors
echo ""
echo "[4/6] Checking for server errors..."
ERROR_LOG=$(npx pm2 logs voice-report --lines 10 --nostream 2>&1 | grep -i 'SyntaxError|Cannot find module|MODULE_NOT_FOUND|ENOENT' || true)
if [ -n "$ERROR_LOG" ]; then
  echo "  ✗ SERVER ERRORS DETECTED:"
  echo "$ERROR_LOG"
  exit 1
else
  echo "  ✓ No server errors"
fi

# Step 5: API Health Check (using cookie jar files for correct session handling)
echo ""
echo "[5/6] Running API health checks..."
FAIL=0
ADMIN_JAR=/tmp/deploy_admin_cookie.txt
ELLERY_JAR=/tmp/deploy_ellery_cookie.txt

# Login as admin
ADMIN_RESP=$(curl -s -c "$ADMIN_JAR" -X POST http://localhost:3070/api/login \
  -H "Content-Type: application/json" \
  -d '{"pin":"12345678"}' 2>/dev/null)

if echo "$ADMIN_RESP" | grep -q '"is_admin":true'; then
  echo "  ✓ Admin login OK"

  # Check reports
  REPORT_COUNT=$(curl -s -b "$ADMIN_JAR" http://localhost:3070/api/reports 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  if [ "$REPORT_COUNT" -gt 0 ] 2>/dev/null; then
    echo "  ✓ Reports: $REPORT_COUNT"
  else
    echo "  ✗ Reports: EMPTY or ERROR"
    FAIL=1
  fi

  # Check people
  PEOPLE_COUNT=$(curl -s -b "$ADMIN_JAR" http://localhost:3070/api/people 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  if [ "$PEOPLE_COUNT" -gt 0 ] 2>/dev/null; then
    echo "  ✓ People: $PEOPLE_COUNT"
  else
    echo "  ✗ People: EMPTY or ERROR"
    FAIL=1
  fi

  # Check projects
  PROJ_COUNT=$(curl -s -b "$ADMIN_JAR" http://localhost:3070/api/projects 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  if [ "$PROJ_COUNT" -gt 0 ] 2>/dev/null; then
    echo "  ✓ Projects: $PROJ_COUNT"
  else
    echo "  ✗ Projects: EMPTY or ERROR"
    FAIL=1
  fi

  # Check templates (Sparks should exist)
  TMPL_COUNT=$(curl -s -b "$ADMIN_JAR" http://localhost:3070/api/templates 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(len([t for t in d if 'sparks' in t.get('id','').lower()]))" 2>/dev/null || echo "0")
  if [ "$TMPL_COUNT" -gt 0 ] 2>/dev/null; then
    echo "  ✓ Sparks templates: $TMPL_COUNT"
  else
    echo "  ✗ Sparks templates: MISSING"
    FAIL=1
  fi
else
  echo "  ✗ Admin login FAILED"
  FAIL=1
fi

# Login as Ellery
ELLERY_RESP=$(curl -s -c "$ELLERY_JAR" -X POST http://localhost:3070/api/login \
  -H "Content-Type: application/json" \
  -d '{"pin":"1234"}' 2>/dev/null)

if echo "$ELLERY_RESP" | grep -q '"name"'; then
  echo "  ✓ Ellery login OK"

  # Verify Ellery can see people
  ELLERY_PEOPLE=$(curl -s -b "$ELLERY_JAR" http://localhost:3070/api/people 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  if [ "$ELLERY_PEOPLE" -gt 0 ] 2>/dev/null; then
    echo "  ✓ Ellery sees people: $ELLERY_PEOPLE"
  else
    echo "  ✗ Ellery sees NO people"
    FAIL=1
  fi
else
  echo "  ✗ Ellery login FAILED"
  FAIL=1
fi

# Cleanup
rm -f "$ADMIN_JAR" "$ELLERY_JAR"

# Step 6: Final verdict
echo ""
echo "=========================================="
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ DEPLOY VERIFIED — ALL CHECKS PASSED"
else
  echo "  ❌ DEPLOY FAILED — FIX BEFORE SHIPPING"
fi
echo "=========================================="
echo ""

exit $FAIL
