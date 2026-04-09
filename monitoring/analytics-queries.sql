-- ============================================================
-- Agent Runtime Phase 1 — Analytics Queries
-- ============================================================
-- These queries power the "Horizon Sparks — Agent Cost Intelligence"
-- Grafana dashboard (see monitoring/grafana-dashboard-agents.json).
--
-- The data model after Phase 1:
--   * voicereport.analytics_ai_costs
--     - agent_name TEXT         (e.g. 'voice.structure.v1')
--     - project_id TEXT         (defaults to 'default')
--     - estimated_cost_cents INTEGER
--     - input_tokens / output_tokens INTEGER
--     - created_at TIMESTAMP
--
--   * horizonsparks.file_check_logs_result_ia
--     - agent_call JSONB        (array of {name, model, costCents, inputTokens, outputTokens, projectId, fileId, attempt, success})
--     - checked_at TIMESTAMP
--     - file_id UUID            (joins horizonsparks.files for project_id)
--
-- Convention: dollar amounts come back as numeric so Grafana can format them.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- Query 1: Per-project cost breakdown (Voice Report side)
-- ────────────────────────────────────────────────────────────
-- Shows: total cost in $, total tokens, call count, grouped by
-- project_id and agent_name for a selected time range.
-- Primary billing query for Stripe attribution.
SELECT
  project_id,
  agent_name,
  COUNT(*)                              AS calls,
  SUM(input_tokens)                     AS tokens_input,
  SUM(output_tokens)                    AS tokens_output,
  SUM(estimated_cost_cents) / 100.0     AS cost_usd
FROM voicereport.analytics_ai_costs
WHERE
  created_at BETWEEN $__timeFrom() AND $__timeTo()
  AND agent_name IS NOT NULL
GROUP BY project_id, agent_name
ORDER BY cost_usd DESC;


-- ────────────────────────────────────────────────────────────
-- Query 2: MRR-style rolling cost (Voice Report)
-- ────────────────────────────────────────────────────────────
-- Time series of daily cost for the selected project. Used for the
-- "Cost over time" chart on the dashboard.
SELECT
  date_trunc('hour', created_at)        AS time,
  agent_name                            AS metric,
  SUM(estimated_cost_cents) / 100.0     AS cost_usd
FROM voicereport.analytics_ai_costs
WHERE
  created_at BETWEEN $__timeFrom() AND $__timeTo()
  AND agent_name IS NOT NULL
GROUP BY time, agent_name
ORDER BY time ASC;


-- ────────────────────────────────────────────────────────────
-- Query 3: LoopFolders agent_call JSONB aggregation
-- ────────────────────────────────────────────────────────────
-- The LoopFolders pipeline stores an array of agent_call objects per
-- file_check_logs row. jsonb_array_elements unrolls them so we can
-- aggregate by project_id and agent name the same way Voice Report does.
--
-- Each element has shape:
--   { name, model, costCents, inputTokens, outputTokens,
--     projectId, fileId, attempt, success, durationMs }
SELECT
  (ac ->> 'projectId')::text            AS project_id,
  (ac ->> 'name')::text                 AS agent_name,
  COUNT(*)                              AS calls,
  SUM((ac ->> 'inputTokens')::int)      AS tokens_input,
  SUM((ac ->> 'outputTokens')::int)     AS tokens_output,
  SUM((ac ->> 'costCents')::int) / 100.0 AS cost_usd
FROM horizonsparks.file_check_logs_result_ia,
     LATERAL jsonb_array_elements(agent_call) AS ac
WHERE
  checked_at BETWEEN $__timeFrom() AND $__timeTo()
  AND agent_call IS NOT NULL
  AND jsonb_typeof(agent_call) = 'array'
GROUP BY project_id, agent_name
ORDER BY cost_usd DESC;


-- ────────────────────────────────────────────────────────────
-- Query 4: UNIFIED per-project cost across BOTH apps
-- ────────────────────────────────────────────────────────────
-- This is the query that drives the Stripe per-project invoice.
-- UNION joins Voice Report (analytics_ai_costs) and LoopFolders
-- (file_check_logs.agent_call JSONB) into a single ranking.
SELECT
  project_id,
  SUM(cost_usd)                         AS total_cost_usd,
  SUM(calls)                            AS total_calls,
  SUM(tokens_input)                     AS total_input_tokens,
  SUM(tokens_output)                    AS total_output_tokens
FROM (
  -- Voice Report side
  SELECT
    project_id,
    COUNT(*)                            AS calls,
    SUM(input_tokens)                   AS tokens_input,
    SUM(output_tokens)                  AS tokens_output,
    SUM(estimated_cost_cents) / 100.0   AS cost_usd
  FROM voicereport.analytics_ai_costs
  WHERE created_at BETWEEN $__timeFrom() AND $__timeTo()
    AND agent_name IS NOT NULL
  GROUP BY project_id

  UNION ALL

  -- LoopFolders side
  SELECT
    (ac ->> 'projectId')::text          AS project_id,
    COUNT(*)                            AS calls,
    SUM((ac ->> 'inputTokens')::int)    AS tokens_input,
    SUM((ac ->> 'outputTokens')::int)   AS tokens_output,
    SUM((ac ->> 'costCents')::int) / 100.0 AS cost_usd
  FROM horizonsparks.file_check_logs_result_ia,
       LATERAL jsonb_array_elements(agent_call) AS ac
  WHERE checked_at BETWEEN $__timeFrom() AND $__timeTo()
    AND agent_call IS NOT NULL
    AND jsonb_typeof(agent_call) = 'array'
  GROUP BY project_id
) combined
GROUP BY project_id
ORDER BY total_cost_usd DESC;


-- ────────────────────────────────────────────────────────────
-- Query 5: Per-agent cost breakdown (both apps, flattened)
-- ────────────────────────────────────────────────────────────
-- Used for the "Cost by agent" pie/bar chart. Helps identify
-- which agents burn the most budget so Phase 2 optimization
-- targets the right layer.
SELECT
  agent_name,
  SUM(calls)                            AS calls,
  SUM(cost_usd)                         AS cost_usd
FROM (
  SELECT
    agent_name,
    COUNT(*)                            AS calls,
    SUM(estimated_cost_cents) / 100.0   AS cost_usd
  FROM voicereport.analytics_ai_costs
  WHERE created_at BETWEEN $__timeFrom() AND $__timeTo()
    AND agent_name IS NOT NULL
  GROUP BY agent_name

  UNION ALL

  SELECT
    (ac ->> 'name')::text               AS agent_name,
    COUNT(*)                            AS calls,
    SUM((ac ->> 'costCents')::int) / 100.0 AS cost_usd
  FROM horizonsparks.file_check_logs_result_ia,
       LATERAL jsonb_array_elements(agent_call) AS ac
  WHERE checked_at BETWEEN $__timeFrom() AND $__timeTo()
    AND agent_call IS NOT NULL
    AND jsonb_typeof(agent_call) = 'array'
  GROUP BY agent_name
) combined
GROUP BY agent_name
ORDER BY cost_usd DESC;


-- ────────────────────────────────────────────────────────────
-- Query 6: Margin analysis (Voice Report)
-- ────────────────────────────────────────────────────────────
-- Uses the plans table to compute margin = plan price − agent cost.
-- Shows margin per company so we can see which customers are
-- profitable after AI costs.
SELECT
  s.company_id,
  p.name                                AS plan_name,
  p.price_cents / 100.0                 AS plan_price_usd,
  COALESCE(SUM(a.estimated_cost_cents), 0) / 100.0 AS ai_cost_usd,
  (p.price_cents - COALESCE(SUM(a.estimated_cost_cents), 0)) / 100.0 AS margin_usd,
  CASE
    WHEN p.price_cents > 0
      THEN ((p.price_cents - COALESCE(SUM(a.estimated_cost_cents), 0))::numeric / p.price_cents) * 100
    ELSE 0
  END                                   AS margin_pct
FROM voicereport.company_subscriptions s
JOIN voicereport.plans p ON s.plan_id = p.id
LEFT JOIN voicereport.analytics_ai_costs a
       ON a.created_at BETWEEN $__timeFrom() AND $__timeTo()
      AND a.agent_name IS NOT NULL
      AND s.company_id = (
        SELECT company_id FROM voicereport.people
        WHERE people.id = a.person_id
        LIMIT 1
      )
WHERE s.status = 'active'
GROUP BY s.company_id, p.name, p.price_cents
ORDER BY margin_usd DESC;


-- ────────────────────────────────────────────────────────────
-- Query 7: Total platform AI spend (single stat)
-- ────────────────────────────────────────────────────────────
-- Big-number card for the dashboard header.
SELECT
  (
    COALESCE((SELECT SUM(estimated_cost_cents)
              FROM voicereport.analytics_ai_costs
              WHERE created_at BETWEEN $__timeFrom() AND $__timeTo()
                AND agent_name IS NOT NULL), 0)
    +
    COALESCE((SELECT SUM((ac ->> 'costCents')::int)
              FROM horizonsparks.file_check_logs_result_ia,
                   LATERAL jsonb_array_elements(agent_call) AS ac
              WHERE checked_at BETWEEN $__timeFrom() AND $__timeTo()
                AND agent_call IS NOT NULL
                AND jsonb_typeof(agent_call) = 'array'), 0)
  ) / 100.0                             AS total_cost_usd;


-- ────────────────────────────────────────────────────────────
-- Query 8: Guardrail violations (health check)
-- ────────────────────────────────────────────────────────────
-- Pulls from Prometheus, NOT postgres. Included here as a
-- reference for the Prometheus panel on the same dashboard:
--
--   sum by (agent_name, guardrail_type) (
--     increase(horizon_agent_guardrail_violations_total[1h])
--   )
--
-- and:
--
--   sum by (agent_name) (
--     increase(horizon_agent_cost_overruns_total[1d])
--   )
