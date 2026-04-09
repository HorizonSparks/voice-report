# Monitoring — Agent Cost Intelligence

This directory contains the analytics layer for Phase 1 agent-runtime cost tracking. Every Claude call across Voice Report and LoopFolders lands in one of two tables; the queries and dashboard here turn that raw data into per-project billing views and per-agent cost breakdowns.

## Files

- **`grafana-dashboard-agents.json`** — Grafana 10.4 dashboard definition. 9 panels total: 4 stat cards (total spend, active projects, invocations, tokens), a unified per-project table, a per-agent pie chart, a stacked time series, and two detail tables (one per app). UID: `horizon-agents-cost`.
- **`analytics-queries.sql`** — The 8 canonical SQL queries that power the dashboard. Each query is documented inline with its purpose and Grafana panel title. Safe to run directly against `postgress_horizonsparks` for ad-hoc analysis.
- **`seed-analytics.sql`** — Sample data seed script for dashboard validation. Inserts 18 Voice Report rows and 2 LoopFolders rows with `agent_name`/`project_id`/`agent_call` JSONB populated across 4 synthetic projects. Use for dev/demo only — never run against production.

## Data model

### Voice Report — `voicereport.analytics_ai_costs`
```
agent_name          TEXT         -- e.g. 'voice.structure.v1'
project_id          TEXT         -- defaults to 'default'
estimated_cost_cents INTEGER
input_tokens        INTEGER
output_tokens       INTEGER
created_at          TIMESTAMP
```
Populated by `database/analytics.js trackAiCost()` on every `runAgent()` call through `server/services/ai/agentRuntime.js`.

### LoopFolders — `horizonsparks.file_check_logs_result_ia`
```
agent_call          JSONB        -- array of {name, model, costCents, inputTokens, outputTokens, projectId, fileId, attempt, success, durationMs}
checked_at          TIMESTAMP
```
Populated by `src/app/api/files/[id]/extract-tables/route.js` which accumulates each `runAgent()` result's `agent` metadata into a per-request buffer, then writes the array into the JSONB column when the check log row is inserted.

GIN index: `idx_file_check_logs_agent_call_gin` for fast containment queries.

## Grafana setup

The dashboard depends on a Postgres data source named `HorizonSparks-Postgres` provisioned at `/home/horizonsparks/observability/grafana/provisioning/datasources/datasources.yml`. That file is managed separately — see the `observability/` repo on the Spark.

Environment requirements (in `observability/.env`):
```
HORIZONSPARKS_PG_PASSWORD=<postgres password>
GF_SERVER_ROOT_URL=https://horizonsparks.com/grafana/
GF_SERVER_SERVE_FROM_SUB_PATH=true
```

## Importing the dashboard

Via curl (as admin):
```bash
curl -s -u admin:$GRAFANA_ADMIN_PASSWORD \
  -X POST http://localhost:3000/api/dashboards/db \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --argjson d "$(cat monitoring/grafana-dashboard-agents.json)" '{dashboard: $d, overwrite: true, message: "Update Agent Cost Intelligence"}')"
```

Or drop the JSON into `observability/grafana/dashboards/` for auto-provisioning on Grafana restart.

## Running the queries manually

```bash
docker exec -it postgress_horizonsparks \
  psql -U horizon_spark -d horizon \
  -f /path/to/analytics-queries.sql
```

For Grafana-specific macros (`$__timeFrom()`, `$__timeTo()`), replace with explicit timestamps before running outside Grafana.

## Verification

After every deploy, verify a row appears in the correct place:

```sql
-- Should return the latest call for each app
SELECT agent_name, project_id, estimated_cost_cents, created_at
FROM voicereport.analytics_ai_costs
ORDER BY created_at DESC LIMIT 5;

SELECT checked_at, jsonb_array_length(agent_call) AS calls
FROM horizonsparks.file_check_logs_result_ia
WHERE agent_call IS NOT NULL
ORDER BY checked_at DESC LIMIT 5;
```

If rows appear with `agent_name` populated (not NULL) and `project_id` not equal to `'default'`, the Phase 1 runtime is writing correctly.

## Known gotchas

1. **`$__timeFrom()` / `$__timeTo()`** are Grafana macros — they only substitute inside panel queries, not when running the SQL file directly in `psql`. Use explicit timestamps for manual debugging.
2. **Anonymous viewers can query** by default (Grafana 10's built-in Viewer role has data source access). If panels show "No data" for anonymous but work for admin, check Grafana's data source team permissions.
3. **`appUrl` mismatch** — if Grafana renders blank panels, check that `GF_SERVER_ROOT_URL` matches the public URL. Localhost vs public URL causes the frontend to load assets from the wrong origin and silently break panel rendering.
4. **Pie chart showing single "value" slice** means `reduceOptions.values` is set to `false`. Must be `true` to show one slice per row.
