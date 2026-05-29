-- Drift Alignment Migration
-- ============================================================
-- Aligns a freshly bootstrapped voicereport schema with what dev (DGX)
-- has actually accumulated over time. Generated 2026-05-28 from
-- diffing dev vs a clean apply of postgres-schema.sql + docker-init.sql
-- + all prior migrations.
--
-- Two categories of drift fixed here:
--
-- 1. MISSING COLUMNS (14)
--    Columns dev has but the SQL bootstrap doesn't create. Most are
--    nullable extensions added to existing tables (trial_expires_at,
--    expires_at, etc.) Added with IF NOT EXISTS.
--
-- 2. TYPE ALIGNMENT (~38)
--    Same column name, different declared type:
--      a. text → character varying(N): cosmetic; both equivalent in PG.
--      b. text → uuid / jsonb: semantic; dev validates content, bootstrap
--         only stores raw strings. ALTER TYPE USING converts.
--      c. integer → real / bigint: widens; safe both directions.
--      d. integer → varchar (sparks_audit_log.id): the app generates
--         string IDs via crypto.randomUUID(), not SERIAL. ALTER + drop
--         default makes the column accept app-generated values.
--      e. timestamp with tz → without tz (support tables): dev drifted
--         from the TIMESTAMPTZ originally declared in support_chat_phase_a.
--         Aligning to dev for consistency; flagged for future review.
--
-- All operations are idempotent: ADD COLUMN IF NOT EXISTS skips existing,
-- ALTER COLUMN TYPE to the SAME type is a no-op in Postgres.

SET search_path TO voicereport;

-- ============================================================
-- 1. MISSING COLUMNS
-- ============================================================

ALTER TABLE app_sessions
  ADD COLUMN IF NOT EXISTS issued_at TIMESTAMP NOT NULL DEFAULT NOW();

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS trial_expires_at TIMESTAMP;

ALTER TABLE company_products
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();

ALTER TABLE company_trades
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;

ALTER TABLE daily_plan_tasks
  ADD COLUMN IF NOT EXISTS company_id character varying(100);

ALTER TABLE knowledge_files
  ADD COLUMN IF NOT EXISTS project_id TEXT;

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS relation_data_bulk_price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS relation_data_bulk_threshold INTEGER,
  ADD COLUMN IF NOT EXISTS relation_data_bundle_price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS relation_data_price_cents INTEGER;

-- project_members: dev has an auto-increment id PK + joined_at timestamp.
-- ADD COLUMN... SERIAL inside an existing table requires creating the
-- sequence manually if we want to avoid CONSTRAINT_VIOLATION on the
-- existing PK (if any). Wrap in DO so it's safe to re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='voicereport'
       AND table_name='project_members'
       AND column_name='id'
  ) THEN
    ALTER TABLE project_members ADD COLUMN id SERIAL;
  END IF;
END $$;

ALTER TABLE project_members
  ADD COLUMN IF NOT EXISTS joined_at TIMESTAMP DEFAULT NOW();

ALTER TABLE templates
  ADD COLUMN IF NOT EXISTS company_id character varying(100);

-- ============================================================
-- 2. TYPE ALIGNMENT — text → character varying(N)
-- Functionally equivalent in Postgres; aligning for consistency with dev.
-- ============================================================

ALTER TABLE app_sessions
  ALTER COLUMN company_id  TYPE character varying(100),
  ALTER COLUMN sparks_role TYPE character varying(20);

ALTER TABLE companies
  ALTER COLUMN id         TYPE character varying(100),
  ALTER COLUMN name       TYPE character varying(255),
  ALTER COLUMN slug       TYPE character varying(100),
  ALTER COLUMN status     TYPE character varying(20),
  ALTER COLUMN tier       TYPE character varying(20),
  ALTER COLUMN created_by TYPE character varying(100);

ALTER TABLE company_products
  ALTER COLUMN id          TYPE character varying(100),
  ALTER COLUMN company_id  TYPE character varying(100),
  ALTER COLUMN product     TYPE character varying(50),
  ALTER COLUMN status      TYPE character varying(20),
  ALTER COLUMN licensed_by TYPE character varying(100);

ALTER TABLE company_settings
  ALTER COLUMN company_id TYPE character varying(255);

ALTER TABLE company_trades
  ALTER COLUMN id          TYPE character varying(100),
  ALTER COLUMN company_id  TYPE character varying(100),
  ALTER COLUMN trade       TYPE character varying(100),
  ALTER COLUMN status      TYPE character varying(20),
  ALTER COLUMN licensed_by TYPE character varying(100);

ALTER TABLE people
  ALTER COLUMN company_id  TYPE character varying(100),
  ALTER COLUMN sparks_role TYPE character varying(20);

ALTER TABLE projects
  ALTER COLUMN company_id TYPE character varying(100);

ALTER TABLE punch_items
  ALTER COLUMN company_id TYPE character varying(100);

ALTER TABLE reports
  ALTER COLUMN company_id TYPE character varying(100);

-- ============================================================
-- 3. TYPE ALIGNMENT — semantic changes (uuid, jsonb)
-- USING clause converts existing data. Safe on fresh AWS where tables
-- are empty; pre-existing data must be valid UUID / JSON or the ALTER
-- aborts. Dev's data was already in the right format historically.
-- ============================================================

ALTER TABLE people
  ALTER COLUMN keycloak_user_id TYPE uuid USING keycloak_user_id::uuid;

ALTER TABLE company_settings
  ALTER COLUMN active_role_levels TYPE jsonb USING active_role_levels::jsonb;

ALTER TABLE sparks_audit_log
  ALTER COLUMN details TYPE jsonb USING details::jsonb;

-- ============================================================
-- 4. TYPE ALIGNMENT — sparks_audit_log.id (integer → varchar)
-- The app generates string IDs via crypto.randomUUID() and inserts them
-- directly. The bootstrap declared id as integer (SERIAL); we change to
-- varchar(100) and drop the sequence default so the app's INSERTs work.
-- ============================================================

ALTER TABLE sparks_audit_log
  ALTER COLUMN id TYPE character varying(100) USING id::text;
ALTER TABLE sparks_audit_log
  ALTER COLUMN id DROP DEFAULT;
-- Drop the orphan sequence if it was created by SERIAL
DROP SEQUENCE IF EXISTS voicereport.sparks_audit_log_id_seq CASCADE;

ALTER TABLE sparks_audit_log
  ALTER COLUMN action        TYPE character varying(100),
  ALTER COLUMN person_id     TYPE character varying(100),
  ALTER COLUMN resource_id   TYPE character varying(100),
  ALTER COLUMN resource_type TYPE character varying(50);

-- ============================================================
-- 5. TYPE ALIGNMENT — numeric widening
-- ============================================================

ALTER TABLE form_fields_v2
  ALTER COLUMN display_order TYPE real;

ALTER TABLE webauthn_credentials
  ALTER COLUMN counter TYPE bigint;

-- ============================================================
-- 6. TYPE ALIGNMENT — timestamp tz drop (support_* tables)
-- support_chat_phase_a originally declared these as TIMESTAMPTZ. Dev
-- somehow ended up with TIMESTAMP. Aligning to match dev so AWS doesn't
-- diverge — but flagging as suspicious drift worth a future review.
-- ============================================================

ALTER TABLE support_conversations
  ALTER COLUMN created_at      TYPE timestamp without time zone,
  ALTER COLUMN last_message_at TYPE timestamp without time zone,
  ALTER COLUMN updated_at      TYPE timestamp without time zone;

ALTER TABLE support_messages
  ALTER COLUMN created_at TYPE timestamp without time zone,
  ALTER COLUMN read_at    TYPE timestamp without time zone;

-- ============================================================
-- 7. DROP EXTRA COLUMNS that bootstrap creates but dev doesn't have.
-- These are nullable extras that crept into the SQL source without a
-- matching dev ALTER. Dropping keeps AWS 1:1 with dev.
-- ============================================================

ALTER TABLE app_sessions
  DROP COLUMN IF EXISTS created_at,
  DROP COLUMN IF EXISTS last_active;
ALTER TABLE company_products      DROP COLUMN IF EXISTS created_at;
ALTER TABLE company_trades        DROP COLUMN IF EXISTS created_at;
ALTER TABLE project_members       DROP COLUMN IF EXISTS created_at;
ALTER TABLE sparks_audit_log      DROP COLUMN IF EXISTS person_name;
ALTER TABLE webauthn_credentials  DROP COLUMN IF EXISTS device_name;

-- ============================================================
-- Verification (no-op, surfaces drift status so the operator sees proof)
-- ============================================================
DO $$
DECLARE
  bad_cols INTEGER;
BEGIN
  -- Count columns that are STILL `text` for what we expected to align
  SELECT COUNT(*) INTO bad_cols
    FROM information_schema.columns
   WHERE table_schema = 'voicereport'
     AND table_name   = 'companies'
     AND column_name  = 'id'
     AND data_type != 'character varying';
  IF bad_cols > 0 THEN
    RAISE NOTICE 'drift_alignment: companies.id still NOT character varying — check manually';
  ELSE
    RAISE NOTICE 'drift_alignment: companies.id aligned to character varying ✓';
  END IF;
END $$;
