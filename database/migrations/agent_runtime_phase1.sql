-- Agent Runtime Phase 1 — analytics_ai_costs schema extension
-- Adds agent_name and project_id columns to attribute every Claude call
-- to a specific agent and project for Stripe per-project billing.
--
-- Safe to re-run: uses IF NOT EXISTS guards.
-- Backward compatible: all existing rows get NULL agent_name, 'default' project_id.

SET search_path TO voicereport;

ALTER TABLE analytics_ai_costs ADD COLUMN IF NOT EXISTS agent_name TEXT;
ALTER TABLE analytics_ai_costs ADD COLUMN IF NOT EXISTS project_id TEXT DEFAULT 'default';

-- Indexes for Stripe billing queries and observability dashboards
CREATE INDEX IF NOT EXISTS idx_ai_costs_agent_name
  ON analytics_ai_costs(agent_name);

CREATE INDEX IF NOT EXISTS idx_ai_costs_project_id
  ON analytics_ai_costs(project_id);

-- Composite index for the primary month-end billing query:
--   SELECT SUM(estimated_cost_cents) FROM analytics_ai_costs
--   WHERE project_id = $1 AND created_at BETWEEN $2 AND $3
--   GROUP BY agent_name
-- Column order: (project_id, created_at, agent_name) — project_id filters first,
-- created_at range is the next bounded filter, agent_name is the GROUP BY (unconstrained).
-- This order lets Postgres do a range scan on (project_id, created_at) then aggregate by agent_name.
CREATE INDEX IF NOT EXISTS idx_ai_costs_project_created_agent
  ON analytics_ai_costs(project_id, created_at, agent_name);
