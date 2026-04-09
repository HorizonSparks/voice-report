-- Seed realistic sample data for dashboard validation
-- Inserts Voice Report rows + LoopFolders agent_call entries across
-- a few projects and agents. Uses random timestamps within the last 24h.

SET search_path TO voicereport;

-- Voice Report: ~20 rows across 3 projects, 6 agents
INSERT INTO analytics_ai_costs (
  request_id, person_id, provider, service, model,
  input_tokens, output_tokens, estimated_cost_cents,
  agent_name, project_id, success, created_at
) VALUES
  ('seed_001', NULL, 'anthropic', 'structure', 'claude-sonnet-4-20250514',
    2400, 1200, 9, 'voice.structure.v1', 'project_pacific_mech', 1, NOW() - INTERVAL '2 hours'),
  ('seed_002', NULL, 'anthropic', 'structure', 'claude-sonnet-4-20250514',
    3100, 1800, 12, 'voice.structure.v1', 'project_pacific_mech', 1, NOW() - INTERVAL '1 hour'),
  ('seed_003', NULL, 'anthropic', 'converse', 'claude-sonnet-4-20250514',
    800, 300, 3, 'voice.converse.v1', 'project_pacific_mech', 1, NOW() - INTERVAL '90 minutes'),
  ('seed_004', NULL, 'anthropic', 'converse', 'claude-sonnet-4-20250514',
    920, 410, 3, 'voice.converse.v1', 'project_pacific_mech', 1, NOW() - INTERVAL '30 minutes'),
  ('seed_005', NULL, 'anthropic', 'refine', 'claude-sonnet-4-20250514',
    1600, 850, 6, 'voice.refine.v1', 'project_pacific_mech', 1, NOW() - INTERVAL '45 minutes'),
  ('seed_006', NULL, 'anthropic', 'agent', 'claude-opus-4-20250514',
    4200, 2100, 17, 'voice.sparks.v1', 'project_pacific_mech', 1, NOW() - INTERVAL '15 minutes'),
  ('seed_007', NULL, 'anthropic', 'field_cleanup', 'claude-sonnet-4-20250514',
    150, 80, 1, 'voice.fieldCleanup.v1', 'project_pacific_mech', 1, NOW() - INTERVAL '10 minutes'),

  ('seed_101', NULL, 'anthropic', 'structure', 'claude-sonnet-4-20250514',
    1800, 1100, 7, 'voice.structure.v1', 'project_koch_industries', 1, NOW() - INTERVAL '3 hours'),
  ('seed_102', NULL, 'anthropic', 'structure', 'claude-sonnet-4-20250514',
    2200, 1300, 9, 'voice.structure.v1', 'project_koch_industries', 1, NOW() - INTERVAL '2 hours'),
  ('seed_103', NULL, 'anthropic', 'converse', 'claude-sonnet-4-20250514',
    700, 280, 3, 'voice.converse.v1', 'project_koch_industries', 1, NOW() - INTERVAL '1 hour'),
  ('seed_104', NULL, 'anthropic', 'jsa_match_check', 'claude-sonnet-4-20250514',
    420, 110, 2, 'voice.jsaMatchCheck.v1', 'project_koch_industries', 1, NOW() - INTERVAL '50 minutes'),
  ('seed_105', NULL, 'anthropic', 'refine', 'claude-sonnet-4-20250514',
    1400, 750, 5, 'voice.refine.v1', 'project_koch_industries', 1, NOW() - INTERVAL '30 minutes'),
  ('seed_106', NULL, 'anthropic', 'agent', 'claude-sonnet-4-20250514',
    2800, 1500, 11, 'voice.sparks.v1', 'project_koch_industries', 1, NOW() - INTERVAL '5 minutes'),

  ('seed_201', NULL, 'anthropic', 'structure', 'claude-sonnet-4-20250514',
    1500, 900, 6, 'voice.structure.v1', 'project_chevron_demo', 1, NOW() - INTERVAL '6 hours'),
  ('seed_202', NULL, 'anthropic', 'converse', 'claude-sonnet-4-20250514',
    650, 260, 2, 'voice.converse.v1', 'project_chevron_demo', 1, NOW() - INTERVAL '5 hours'),
  ('seed_203', NULL, 'anthropic', 'jsa_match_check', 'claude-sonnet-4-20250514',
    380, 95, 1, 'voice.jsaMatchCheck.v1', 'project_chevron_demo', 1, NOW() - INTERVAL '4 hours'),

  -- 'default' project (legacy rows before routes pass projectId)
  ('seed_legacy_01', NULL, 'anthropic', 'structure', 'claude-sonnet-4-20250514',
    2000, 1000, 8, 'voice.structure.v1', 'default', 1, NOW() - INTERVAL '7 hours'),
  ('seed_legacy_02', NULL, 'anthropic', 'converse', 'claude-sonnet-4-20250514',
    750, 320, 3, 'voice.converse.v1', 'default', 1, NOW() - INTERVAL '8 hours');

-- LoopFolders: seed agent_call JSONB entries on the existing rows
-- (since file_check_logs_result_ia has FK to files, we update existing rows)
UPDATE horizonsparks.file_check_logs_result_ia
SET agent_call = jsonb_build_array(
  jsonb_build_object(
    'name', 'loopfolders.tableExtract.v1',
    'model', 'claude-sonnet-4-20250514',
    'inputTokens', 12500,
    'outputTokens', 8400,
    'costCents', 16,
    'durationMs', 45000,
    'attempt', 1,
    'success', true,
    'projectId', 'project_pacific_mech',
    'fileId', file_id::text
  )
)
WHERE file_id IN (
  SELECT id FROM horizonsparks.files ORDER BY created_at DESC LIMIT 3
)
AND agent_call IS NULL;

UPDATE horizonsparks.file_check_logs_result_ia
SET agent_call = jsonb_build_array(
  jsonb_build_object(
    'name', 'loopfolders.tableExtract.v1',
    'model', 'claude-sonnet-4-20250514',
    'inputTokens', 8200,
    'outputTokens', 5100,
    'costCents', 10,
    'durationMs', 32000,
    'attempt', 1,
    'success', true,
    'projectId', 'project_koch_industries',
    'fileId', file_id::text
  ),
  jsonb_build_object(
    'name', 'loopfolders.tableExtract.v1',
    'model', 'claude-sonnet-4-20250514',
    'inputTokens', 4100,
    'outputTokens', 2800,
    'costCents', 5,
    'durationMs', 18000,
    'attempt', 1,
    'success', true,
    'projectId', 'project_koch_industries',
    'fileId', file_id::text
  )
)
WHERE file_id IN (
  SELECT id FROM horizonsparks.files ORDER BY created_at DESC OFFSET 3 LIMIT 2
)
AND agent_call IS NULL;

-- Verify seed
SELECT 'voicereport.analytics_ai_costs seeded rows' AS table_name, COUNT(*) AS count
FROM voicereport.analytics_ai_costs
WHERE request_id LIKE 'seed_%';

SELECT 'loopfolders seeded rows' AS table_name, COUNT(*) AS count
FROM horizonsparks.file_check_logs_result_ia
WHERE agent_call IS NOT NULL;
