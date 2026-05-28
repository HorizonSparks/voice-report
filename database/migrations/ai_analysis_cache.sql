-- AI Analysis Cache — training data collection for fine-tuning
-- Every intelligence analysis is cached here for:
--   1. Avoiding repeat API calls (cost savings)
--   2. Building training dataset for fine-tuned Boss Agent
--   3. Provenance tracking ("Analyzed on [date]")
--
-- Safe to re-run: uses IF NOT EXISTS guards.

SET search_path TO horizonsparks;

CREATE TABLE IF NOT EXISTS ai_analysis_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What was analyzed
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_id UUID REFERENCES files(id) ON DELETE SET NULL,
  loop_numbers TEXT[] NOT NULL DEFAULT '{}',

  -- The question and context
  question TEXT NOT NULL,
  analysis_context TEXT,
  loop_folder_groups JSONB,

  -- The AI response
  analysis_text TEXT NOT NULL,
  reasoning_version TEXT NOT NULL DEFAULT 'v1.0',

  -- Usage & cost tracking
  model TEXT NOT NULL DEFAULT 'claude-opus-4',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_cents NUMERIC(10,4) NOT NULL DEFAULT 0,
  tool_iterations INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,

  -- Training data status
  exported_to_training BOOLEAN NOT NULL DEFAULT false,
  training_quality_score SMALLINT,  -- 1-5, null = not reviewed

  -- Metadata
  person_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_ai_cache_project
  ON ai_analysis_cache(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_cache_training
  ON ai_analysis_cache(exported_to_training, training_quality_score)
  WHERE exported_to_training = false;

CREATE INDEX IF NOT EXISTS idx_ai_cache_loop_numbers
  ON ai_analysis_cache USING GIN(loop_numbers);

-- Training data export view — ready-to-use for fine-tuning
CREATE OR REPLACE VIEW ai_training_data AS
SELECT
  id,
  question,
  analysis_context,
  loop_folder_groups,
  analysis_text,
  reasoning_version,
  model,
  input_tokens + output_tokens as total_tokens,
  training_quality_score,
  created_at
FROM ai_analysis_cache
WHERE training_quality_score IS NULL OR training_quality_score >= 3
ORDER BY created_at;

COMMENT ON TABLE ai_analysis_cache IS 'Cached AI analyses for training data collection. Every intelligence analysis is saved here automatically. This is the asset — the training dataset for the fine-tuned Boss Agent.';
