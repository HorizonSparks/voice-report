#!/bin/bash
# ============================================
# Creates per-company databases with voicereport schema
# Mount as /docker-entrypoint-initdb.d/03-companies.sh
# ============================================

set -e

COMPANY_DBS="horizon_sparks horizon_pacific_mechanical horizon_summit_electrical"
SCHEMA_FILE="/docker-entrypoint-initdb.d/01-schema.sql"

for db in $COMPANY_DBS; do
  echo "Creating company database: $db"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "CREATE DATABASE ${db};" 2>/dev/null || echo "  Database $db already exists"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" -f "$SCHEMA_FILE"
  echo "  Schema applied to $db"
done

echo "All company databases initialized."
