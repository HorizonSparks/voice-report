#!/bin/bash
# ============================================================
# Voice Report — AWS DB Bootstrap
# Applies the `voicereport` schema + all migrations to a FRESH
# postgress_horizonsparks on AWS. Seeds the default company so
# Keycloak auto-provision (KEYCLOAK_AUTO_PROVISION_DEFAULT_COMPANY)
# has a valid target.
#
# RUN ONCE on the AWS host. Subsequent runs are mostly idempotent
# (uses IF NOT EXISTS / ON CONFLICT throughout), but no need to
# re-run unless you're adding new migrations.
#
# Usage (on AWS host):
#   cd /home/ubuntu/production/voice-report
#   ./bootstrap-aws-db.sh
# ============================================================

set -e

# Read PG password from .env (no hardcoded secret in this script)
if [ ! -f .env ]; then
  echo "✗ .env not found in $(pwd)"
  exit 1
fi
PG_PASSWORD=$(grep '^PG_PASSWORD=' .env | head -1 | cut -d= -f2-)
if [ -z "$PG_PASSWORD" ]; then
  echo "✗ PG_PASSWORD not set in .env"
  exit 1
fi

# Helper: run psql on postgress_horizonsparks via docker exec, with
# stdin coming from a file. Bails on first error.
PSQL() {
  sudo docker exec -i -e PGPASSWORD="$PG_PASSWORD" postgress_horizonsparks \
    psql -U horizon_spark -d horizon -v ON_ERROR_STOP=1 "$@"
}

echo ""
echo "=========================================="
echo "  AWS DB BOOTSTRAP — Voice Report"
echo "=========================================="

# ----------------------------------------------------------------
# Step 1: Base schema
# ----------------------------------------------------------------
echo ""
echo "[1/4] Applying postgres-schema.sql (creates voicereport.*)..."
if PSQL < database/postgres-schema.sql > /dev/null 2>&1; then
  echo "  ✓ Base schema applied"
else
  echo "  ✗ Base schema FAILED — re-run with verbose:"
  echo "      PSQL_VERBOSE=1 $0"
  PSQL < database/postgres-schema.sql 2>&1 | tail -10
  exit 1
fi

# ----------------------------------------------------------------
# Step 2: Billing / init tables
# ----------------------------------------------------------------
echo ""
echo "[2/4] Applying docker-init.sql (billing tables)..."
if PSQL < database/docker-init.sql > /dev/null 2>&1; then
  echo "  ✓ Billing tables applied"
else
  echo "  ✗ docker-init FAILED:"
  PSQL < database/docker-init.sql 2>&1 | tail -10
  exit 1
fi

# ----------------------------------------------------------------
# Step 3: Migrations in chronological order
# ----------------------------------------------------------------
echo ""
echo "[3/4] Applying migrations..."
# Order: alphabetical. The support_chat_phase_{a,b,c,d,e} series MUST run
# in alphabetical order (phase_a creates tables that phase_e references),
# and that order also satisfies all other migration dependencies.
#
# Do NOT use ls -tr (mtime): rsync onto AWS preserves order weakly and the
# files end up with near-identical timestamps, scrambling the sequence.
MIGRATIONS=$(ls -1 database/migrations/*.sql 2>/dev/null | sort)
if [ -z "$MIGRATIONS" ]; then
  echo "  ⚠ No migrations found in database/migrations/"
else
  for m in $MIGRATIONS; do
    name=$(basename "$m")
    if PSQL < "$m" > /dev/null 2>&1; then
      echo "  ✓ $name"
    else
      echo "  ✗ $name FAILED:"
      PSQL < "$m" 2>&1 | tail -5
      exit 1
    fi
  done
fi

# ----------------------------------------------------------------
# Step 4: Seed minimum data
# ----------------------------------------------------------------
echo ""
echo "[4/4] Seeding default company (for Keycloak auto-provision)..."
PSQL <<'SQL' > /dev/null
INSERT INTO voicereport.companies (id, name, slug, status, tier, notes, created_at, updated_at)
VALUES (
  'company_horizon_sparks',
  'Horizon Sparks',
  'horizon-sparks',
  'active',
  'enterprise',
  'Bootstrap row — primary tenant. Keycloak auto-provision default targets this id.',
  NOW(), NOW()
)
ON CONFLICT (id) DO NOTHING;
SQL
echo "  ✓ company_horizon_sparks seeded (or already existed)"

# ----------------------------------------------------------------
# Verification
# ----------------------------------------------------------------
echo ""
echo "=========================================="
echo "  Verification"
echo "=========================================="
PSQL -c "
SELECT 'companies' AS what, COUNT(*)::text AS n FROM voicereport.companies
UNION ALL SELECT 'people',   COUNT(*)::text FROM voicereport.people
UNION ALL SELECT 'projects', COUNT(*)::text FROM voicereport.projects
UNION ALL SELECT 'support_conversations', COUNT(*)::text FROM voicereport.support_conversations
UNION ALL SELECT 'support_conversation_events', COUNT(*)::text FROM voicereport.support_conversation_events
UNION ALL SELECT 'push_subscriptions', COUNT(*)::text FROM voicereport.push_subscriptions;
"

echo ""
echo "=========================================="
echo "  ✅ BOOTSTRAP COMPLETE"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Confirm admin login works:"
echo "       curl -s -X POST http://localhost:3070/api/login \\"
echo "         -H 'Content-Type: application/json' \\"
echo "         -d '{\"pin\":\"12345678\"}'"
echo "     (PIN comes from ADMIN_PIN in .env)"
echo ""
echo "  2. Onboard real companies via /api/sparks/companies/onboard"
echo "     (admin only — see server/routes/sparks.js for body shape)"
echo ""
