-- P2.1: tenant-stamp safety observations + preserve the full observation card verbatim.
-- Also applied idempotently at runtime by safetyObservations.ensureSchema() so the route
-- is correct even where this migration has not been run yet.
ALTER TABLE safety_observations ADD COLUMN IF NOT EXISTS company_id TEXT;
ALTER TABLE safety_observations ADD COLUMN IF NOT EXISTS form_data TEXT;
CREATE INDEX IF NOT EXISTS idx_safety_obs_company ON safety_observations(company_id);
CREATE INDEX IF NOT EXISTS idx_safety_obs_person ON safety_observations(person_id);
