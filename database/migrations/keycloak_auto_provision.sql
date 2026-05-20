-- Keycloak Auto-Provisioning Support
-- Prerequisite schema for the resolvePersonFromClaims auto-create path
-- (server/middleware/verifyKeycloakJwt.js). When a JWT authenticates a
-- user that has no matching row in voicereport.people, the resolver will
-- INSERT one — provided the JWT carries a company_id claim.
--
-- Concurrent requests for the same brand-new sub could race. The unique
-- partial index below makes the second INSERT fail with 23505 so the
-- resolver can recover by re-selecting the winner's row.

SET search_path TO voicereport;

-- Unique index on keycloak_user_id (partial — only non-null values).
-- Postgres allows multiple NULLs in a unique index, so legacy people rows
-- without a Keycloak mapping continue to coexist freely.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_people_keycloak_user_id
  ON voicereport.people(keycloak_user_id)
  WHERE keycloak_user_id IS NOT NULL;

-- Defensive: surface any pre-existing duplicates that would have blocked
-- the index above. (None expected — the resolver-side lookup already
-- uses LIMIT 1, but if a manual SQL mistake created dupes we want to know.)
DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT keycloak_user_id
      FROM voicereport.people
     WHERE keycloak_user_id IS NOT NULL
     GROUP BY keycloak_user_id
    HAVING COUNT(*) > 1
  ) d;
  RAISE NOTICE 'keycloak_auto_provision: duplicate keycloak_user_id rows = %', dup_count;
END $$;
