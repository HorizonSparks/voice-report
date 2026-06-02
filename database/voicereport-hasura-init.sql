-- voicereport: fix Hasura metadata inconsistencies
-- Idempotente: se puede correr varias veces.
-- Cubre:
--   1) Crea voicereport.ops_approvals (no existe en ninguna BD).
--   2) Garantiza FKs que Hasura espera (companies <- *, people <- *).

BEGIN;

CREATE SCHEMA IF NOT EXISTS voicereport;

-- ============================================================
-- 1) ops_approvals
-- ============================================================
-- Estructura inferida del nombre. Ajustar columnas si el modelo
-- real difiere (status enum, payload jsonb, etc.).
CREATE TABLE IF NOT EXISTS voicereport.ops_approvals (
    id              text PRIMARY KEY,
    company_id      varchar(100) NOT NULL,
    entity_type     text NOT NULL,
    entity_id       text NOT NULL,
    action          text NOT NULL,
    payload         jsonb,
    status          text NOT NULL DEFAULT 'pending',
    requested_by    text,
    approved_by     text,
    approved_at     timestamp,
    rejected_at     timestamp,
    notes           text,
    created_at      timestamp NOT NULL DEFAULT now(),
    updated_at      timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_approvals_company
    ON voicereport.ops_approvals(company_id);
CREATE INDEX IF NOT EXISTS idx_ops_approvals_status
    ON voicereport.ops_approvals(status);
CREATE INDEX IF NOT EXISTS idx_ops_approvals_entity
    ON voicereport.ops_approvals(entity_type, entity_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'ops_approvals_company_id_fkey'
          AND table_schema = 'voicereport'
    ) THEN
        ALTER TABLE voicereport.ops_approvals
            ADD CONSTRAINT ops_approvals_company_id_fkey
            FOREIGN KEY (company_id) REFERENCES voicereport.companies(id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'ops_approvals_requested_by_fkey'
          AND table_schema = 'voicereport'
    ) THEN
        ALTER TABLE voicereport.ops_approvals
            ADD CONSTRAINT ops_approvals_requested_by_fkey
            FOREIGN KEY (requested_by) REFERENCES voicereport.people(id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'ops_approvals_approved_by_fkey'
          AND table_schema = 'voicereport'
    ) THEN
        ALTER TABLE voicereport.ops_approvals
            ADD CONSTRAINT ops_approvals_approved_by_fkey
            FOREIGN KEY (approved_by) REFERENCES voicereport.people(id);
    END IF;
END $$;

-- ============================================================
-- 2) FKs company_id -> companies(id)
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name='punch_items_company_id_fkey' AND table_schema='voicereport') THEN
        ALTER TABLE voicereport.punch_items
            ADD CONSTRAINT punch_items_company_id_fkey
            FOREIGN KEY (company_id) REFERENCES voicereport.companies(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name='templates_company_id_fkey' AND table_schema='voicereport') THEN
        ALTER TABLE voicereport.templates
            ADD CONSTRAINT templates_company_id_fkey
            FOREIGN KEY (company_id) REFERENCES voicereport.companies(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name='projects_company_id_fkey' AND table_schema='voicereport') THEN
        ALTER TABLE voicereport.projects
            ADD CONSTRAINT projects_company_id_fkey
            FOREIGN KEY (company_id) REFERENCES voicereport.companies(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name='people_company_id_fkey' AND table_schema='voicereport') THEN
        ALTER TABLE voicereport.people
            ADD CONSTRAINT people_company_id_fkey
            FOREIGN KEY (company_id) REFERENCES voicereport.companies(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name='daily_plan_tasks_company_id_fkey' AND table_schema='voicereport') THEN
        ALTER TABLE voicereport.daily_plan_tasks
            ADD CONSTRAINT daily_plan_tasks_company_id_fkey
            FOREIGN KEY (company_id) REFERENCES voicereport.companies(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name='reports_company_id_fkey' AND table_schema='voicereport') THEN
        ALTER TABLE voicereport.reports
            ADD CONSTRAINT reports_company_id_fkey
            FOREIGN KEY (company_id) REFERENCES voicereport.companies(id);
    END IF;
END $$;

-- ============================================================
-- 3) FKs people <-> shared_folders / shared_files / shared_folder_members / webauthn_credentials
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name='shared_folders_created_by_fkey' AND table_schema='voicereport') THEN
        ALTER TABLE voicereport.shared_folders
            ADD CONSTRAINT shared_folders_created_by_fkey
            FOREIGN KEY (created_by) REFERENCES voicereport.people(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name='shared_files_uploaded_by_fkey' AND table_schema='voicereport') THEN
        ALTER TABLE voicereport.shared_files
            ADD CONSTRAINT shared_files_uploaded_by_fkey
            FOREIGN KEY (uploaded_by) REFERENCES voicereport.people(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name='shared_folder_members_person_id_fkey' AND table_schema='voicereport') THEN
        ALTER TABLE voicereport.shared_folder_members
            ADD CONSTRAINT shared_folder_members_person_id_fkey
            FOREIGN KEY (person_id) REFERENCES voicereport.people(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name='webauthn_credentials_person_id_fkey' AND table_schema='voicereport') THEN
        ALTER TABLE voicereport.webauthn_credentials
            ADD CONSTRAINT webauthn_credentials_person_id_fkey
            FOREIGN KEY (person_id) REFERENCES voicereport.people(id) ON DELETE CASCADE;
    END IF;
END $$;

COMMIT;

-- Después de aplicar este SQL, en Hasura corre: "Reload metadata"
-- y luego "Track" la tabla voicereport.ops_approvals.
