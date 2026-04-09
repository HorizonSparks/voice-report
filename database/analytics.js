/**
 * Analytics module for Voice Report
 * Tracks API calls, AI costs, client events, and voice conversation funnels
 * PostgreSQL async version
 */

const { db } = require('./db');
const crypto = require('crypto');

/**
 * Express middleware — auto-tracks every /api/* request
 */
function middleware(req, res, next) {
  const requestId = crypto.randomUUID();
  req.analyticsId = requestId;
  const start = Date.now();

  const originalJson = res.json.bind(res);
  let statusCode = 200;

  res.json = function(body) {
    statusCode = res.statusCode;
    return originalJson(body);
  };

  res.on('finish', () => {
    try {
      statusCode = res.statusCode;
      const duration = Date.now() - start;
      const personId = req.body?.person_id || req.params?.person_id || req.params?.id || null;
      const errorMsg = statusCode >= 400 ? (res._analyticsError || null) : null;
      db.query(
        'INSERT INTO analytics_api_calls (request_id, person_id, endpoint, method, status_code, duration_ms, error_message) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [requestId, personId, req.path, req.method, statusCode, duration, errorMsg]
      ).catch(() => {});
    } catch(e) { /* silent */ }
  });

  next();
}

/**
 * Track AI API cost
 */
async function trackAiCost({ request_id, person_id, provider, service, model, input_tokens, output_tokens, audio_duration_seconds, tts_characters, estimated_cost_cents, context_type, knowledge_modules, conversation_round, phase, success, error_details, agent_name, project_id }) {
  try {
    await db.query(
      'INSERT INTO analytics_ai_costs (request_id, person_id, provider, service, model, input_tokens, output_tokens, audio_duration_seconds, tts_characters, estimated_cost_cents, context_type, knowledge_modules, conversation_round, phase, success, error_details, agent_name, project_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
      [request_id || null, person_id || null, provider, service, model,
       input_tokens || 0, output_tokens || 0, audio_duration_seconds || 0, tts_characters || 0,
       estimated_cost_cents || 0, context_type || null,
       knowledge_modules ? JSON.stringify(knowledge_modules) : null,
       conversation_round || null, phase || null, success !== undefined ? success : 1, error_details || null,
       agent_name || null, project_id || 'default']
    );
  } catch(e) { /* silent */ }
}

/**
 * Track batched client events
 */
async function trackClientEvents(sessionId, personId, events) {
  try {
    for (const e of events) {
      await db.query(
        'INSERT INTO analytics_client_events (person_id, session_id, event_type, event_name, event_data, screen, duration_ms) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [personId || null, sessionId, e.event_type, e.event_name, e.event_data || null, e.screen || null, e.duration_ms || null]
      );
    }
    // Upsert session
    await db.query(
      `INSERT INTO analytics_sessions (id, person_id, started_at, last_activity_at, screens_visited, ai_calls_made, user_agent)
       VALUES ($1, $2, NOW(), NOW(), 0, 0, $3)
       ON CONFLICT(id) DO UPDATE SET last_activity_at = NOW(), person_id = COALESCE(EXCLUDED.person_id, analytics_sessions.person_id)`,
      [sessionId, personId, null]
    );
    const screenViews = events.filter(e => e.event_type === 'screen_view').length;
    if (screenViews > 0) {
      await db.query(
        'UPDATE analytics_sessions SET screens_visited = screens_visited + $1, last_activity_at = NOW() WHERE id = $2',
        [screenViews, sessionId]
      );
    }
  } catch(e) { /* silent */ }
}

/**
 * Track refine funnel stage transition
 */
async function trackRefineFunnel({ person_id, session_id, funnel_id, context_type, stage, from_stage, round, duration_in_stage_ms, outcome }) {
  try {
    await db.query(
      'INSERT INTO analytics_refine_funnels (person_id, session_id, funnel_id, context_type, stage, from_stage, round, duration_in_stage_ms, outcome) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [person_id || null, session_id || null, funnel_id, context_type || null, stage, from_stage || null, round || 0, duration_in_stage_ms || null, outcome || null]
    );
  } catch(e) { /* silent */ }
}

/**
 * Dashboard aggregation queries
 */
async function getDashboard(filters = {}) {
  const from = filters.from || '2000-01-01';
  const to = filters.to || '2099-12-31';
  const companyId = filters.company_id || null;
  const companyParams = companyId ? [from, to, companyId] : [from, to];

  const summary = (await db.query(
    companyId
      ? 'SELECT COUNT(*) as total_api_calls, COUNT(DISTINCT c.person_id) as unique_users FROM analytics_api_calls c INNER JOIN voicereport.people cp ON c.person_id = cp.id AND cp.company_id = $3 WHERE c.created_at BETWEEN $1 AND $2'
      : 'SELECT COUNT(*) as total_api_calls, COUNT(DISTINCT person_id) as unique_users FROM analytics_api_calls WHERE created_at BETWEEN $1 AND $2',
    companyParams
  )).rows[0];

  const totalCost = (await db.query(
    companyId
      ? 'SELECT COALESCE(SUM(c.estimated_cost_cents), 0) as total_cost_cents FROM analytics_ai_costs c INNER JOIN voicereport.people cp ON c.person_id = cp.id AND cp.company_id = $3 WHERE c.created_at BETWEEN $1 AND $2'
      : 'SELECT COALESCE(SUM(estimated_cost_cents), 0) as total_cost_cents FROM analytics_ai_costs WHERE created_at BETWEEN $1 AND $2',
    companyParams
  )).rows[0];

  const costByProvider = (await db.query(
    companyId
      ? `SELECT c.provider, c.service, COUNT(*) as total_calls, SUM(c.estimated_cost_cents) as total_cost_cents,
         AVG(c.estimated_cost_cents)::INTEGER as avg_cost_cents, SUM(c.input_tokens) as total_input_tokens, SUM(c.output_tokens) as total_output_tokens
         FROM analytics_ai_costs c INNER JOIN voicereport.people cp ON c.person_id = cp.id AND cp.company_id = $3
         WHERE c.created_at BETWEEN $1 AND $2 GROUP BY c.provider, c.service ORDER BY total_cost_cents DESC`
      : `SELECT provider, service, COUNT(*) as total_calls, SUM(estimated_cost_cents) as total_cost_cents,
         AVG(estimated_cost_cents)::INTEGER as avg_cost_cents, SUM(input_tokens) as total_input_tokens, SUM(output_tokens) as total_output_tokens
         FROM analytics_ai_costs WHERE created_at BETWEEN $1 AND $2 GROUP BY provider, service ORDER BY total_cost_cents DESC`,
    companyParams
  )).rows;

  const costByPerson = (await db.query(
    companyId
      ? `SELECT c.person_id, p.name as person_name, SUM(c.estimated_cost_cents) as total_cost_cents, COUNT(*) as call_count
         FROM analytics_ai_costs c LEFT JOIN voicereport.people p ON c.person_id = p.id
         WHERE c.created_at BETWEEN $1 AND $2 AND p.company_id = $3 GROUP BY c.person_id, p.name ORDER BY total_cost_cents DESC LIMIT 20`
      : `SELECT c.person_id, p.name as person_name, SUM(c.estimated_cost_cents) as total_cost_cents, COUNT(*) as call_count
         FROM analytics_ai_costs c LEFT JOIN people p ON c.person_id = p.id
         WHERE c.created_at BETWEEN $1 AND $2 GROUP BY c.person_id, p.name ORDER BY total_cost_cents DESC LIMIT 20`,
    companyParams
  )).rows;

  const costByDay = (await db.query(
    companyId
      ? `SELECT c.created_at::date as date,
         SUM(CASE WHEN c.provider = 'anthropic' THEN c.estimated_cost_cents ELSE 0 END) as anthropic_cents,
         SUM(CASE WHEN c.provider = 'openai' THEN c.estimated_cost_cents ELSE 0 END) as openai_cents,
         SUM(c.estimated_cost_cents) as total_cents
         FROM analytics_ai_costs c INNER JOIN voicereport.people cp ON c.person_id = cp.id AND cp.company_id = $3
         WHERE c.created_at BETWEEN $1 AND $2
         GROUP BY c.created_at::date ORDER BY date DESC LIMIT 30`
      : `SELECT created_at::date as date,
         SUM(CASE WHEN provider = 'anthropic' THEN estimated_cost_cents ELSE 0 END) as anthropic_cents,
         SUM(CASE WHEN provider = 'openai' THEN estimated_cost_cents ELSE 0 END) as openai_cents,
         SUM(estimated_cost_cents) as total_cents
         FROM analytics_ai_costs WHERE created_at BETWEEN $1 AND $2
         GROUP BY created_at::date ORDER BY date DESC LIMIT 30`,
    companyParams
  )).rows;

  const apiPerformance = (await db.query(
    companyId
      ? `SELECT a.endpoint, COUNT(*) as call_count, AVG(a.duration_ms)::INTEGER as avg_duration_ms,
         MAX(a.duration_ms) as max_duration_ms,
         ROUND(100.0 * SUM(CASE WHEN a.status_code >= 400 THEN 1 ELSE 0 END) / COUNT(*), 1) as error_rate_pct
         FROM analytics_api_calls a INNER JOIN voicereport.people cp ON a.person_id = cp.id AND cp.company_id = $3
         WHERE a.created_at BETWEEN $1 AND $2 GROUP BY a.endpoint ORDER BY call_count DESC`
      : `SELECT endpoint, COUNT(*) as call_count, AVG(duration_ms)::INTEGER as avg_duration_ms,
         MAX(duration_ms) as max_duration_ms,
         ROUND(100.0 * SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) / COUNT(*), 1) as error_rate_pct
         FROM analytics_api_calls WHERE created_at BETWEEN $1 AND $2 GROUP BY endpoint ORDER BY call_count DESC`,
    companyParams
  )).rows;

  const apiErrors = (await db.query(
    companyId
      ? `SELECT a.endpoint, a.status_code, COUNT(*) as count, MAX(a.error_message) as latest_error
         FROM analytics_api_calls a INNER JOIN voicereport.people cp ON a.person_id = cp.id AND cp.company_id = $3
         WHERE a.status_code >= 400 AND a.created_at BETWEEN $1 AND $2
         GROUP BY a.endpoint, a.status_code ORDER BY count DESC LIMIT 20`
      : `SELECT endpoint, status_code, COUNT(*) as count, MAX(error_message) as latest_error
         FROM analytics_api_calls WHERE status_code >= 400 AND created_at BETWEEN $1 AND $2
         GROUP BY endpoint, status_code ORDER BY count DESC LIMIT 20`,
    companyParams
  )).rows;

  const screenViews = (await db.query(
    companyId
      ? `SELECT e.event_name as screen, COUNT(*) as view_count, AVG(e.duration_ms)::INTEGER as avg_duration_ms,
         COUNT(DISTINCT e.person_id) as unique_users
         FROM analytics_client_events e INNER JOIN voicereport.people cp ON e.person_id = cp.id AND cp.company_id = $3
         WHERE e.event_type = 'screen_view' AND e.created_at BETWEEN $1 AND $2
         GROUP BY e.event_name ORDER BY view_count DESC`
      : `SELECT event_name as screen, COUNT(*) as view_count, AVG(duration_ms)::INTEGER as avg_duration_ms,
         COUNT(DISTINCT person_id) as unique_users
         FROM analytics_client_events WHERE event_type = 'screen_view' AND created_at BETWEEN $1 AND $2
         GROUP BY event_name ORDER BY view_count DESC`,
    companyParams
  )).rows;

  const refineFunnel = (await db.query(
    companyId
      ? `SELECT r.stage, COUNT(*) as count FROM analytics_refine_funnels r
         INNER JOIN voicereport.people cp ON r.person_id = cp.id AND cp.company_id = $3
         WHERE r.created_at BETWEEN $1 AND $2 GROUP BY r.stage`
      : 'SELECT stage, COUNT(*) as count FROM analytics_refine_funnels WHERE created_at BETWEEN $1 AND $2 GROUP BY stage',
    companyParams
  )).rows;

  const refineOutcomes = (await db.query(
    companyId
      ? `SELECT r.outcome, COUNT(*) as count FROM analytics_refine_funnels r
         INNER JOIN voicereport.people cp ON r.person_id = cp.id AND cp.company_id = $3
         WHERE r.outcome IS NOT NULL AND r.created_at BETWEEN $1 AND $2 GROUP BY r.outcome`
      : 'SELECT outcome, COUNT(*) as count FROM analytics_refine_funnels WHERE outcome IS NOT NULL AND created_at BETWEEN $1 AND $2 GROUP BY outcome',
    companyParams
  )).rows;

  const refineByContext = (await db.query(
    companyId
      ? `SELECT r.context_type, COUNT(DISTINCT r.funnel_id) as conversations, AVG(r.round) as avg_rounds
         FROM analytics_refine_funnels r INNER JOIN voicereport.people cp ON r.person_id = cp.id AND cp.company_id = $3
         WHERE r.created_at BETWEEN $1 AND $2 GROUP BY r.context_type`
      : `SELECT context_type, COUNT(DISTINCT funnel_id) as conversations, AVG(round) as avg_rounds
         FROM analytics_refine_funnels WHERE created_at BETWEEN $1 AND $2 GROUP BY context_type`,
    companyParams
  )).rows;

  const knowledgeUsage = (await db.query(
    companyId
      ? `SELECT c.knowledge_modules, COUNT(*) as load_count FROM analytics_ai_costs c
         INNER JOIN voicereport.people cp ON c.person_id = cp.id AND cp.company_id = $3
         WHERE c.knowledge_modules IS NOT NULL AND c.created_at BETWEEN $1 AND $2
         GROUP BY c.knowledge_modules ORDER BY load_count DESC LIMIT 20`
      : `SELECT knowledge_modules, COUNT(*) as load_count FROM analytics_ai_costs
         WHERE knowledge_modules IS NOT NULL AND created_at BETWEEN $1 AND $2
         GROUP BY knowledge_modules ORDER BY load_count DESC LIMIT 20`,
    companyParams
  )).rows;

  const sessionStats = (await db.query(
    companyId
      ? `SELECT COUNT(*) as total_sessions, AVG(s.screens_visited) as avg_screens, AVG(s.ai_calls_made) as avg_ai_calls
         FROM analytics_sessions s INNER JOIN voicereport.people cp ON s.person_id = cp.id AND cp.company_id = $3
         WHERE s.started_at BETWEEN $1 AND $2`
      : `SELECT COUNT(*) as total_sessions, AVG(screens_visited) as avg_screens, AVG(ai_calls_made) as avg_ai_calls
         FROM analytics_sessions WHERE started_at BETWEEN $1 AND $2`,
    companyParams
  )).rows[0];

  return {
    summary: { ...summary, total_ai_cost_cents: totalCost.total_cost_cents, total_ai_cost_dollars: (totalCost.total_cost_cents / 100).toFixed(2) },
    costs: { by_provider: costByProvider, by_person: costByPerson, by_day: costByDay },
    api_performance: { by_endpoint: apiPerformance, errors: apiErrors },
    user_behavior: { screen_views: screenViews, session_stats: sessionStats },
    voice_conversations: {
      refine_funnel: Object.fromEntries(refineFunnel.map(r => [r.stage, parseInt(r.count)])),
      outcomes: Object.fromEntries(refineOutcomes.map(r => [r.outcome, parseInt(r.count)])),
      by_context_type: refineByContext,
    },
    content: { knowledge_usage: knowledgeUsage },
  };
}

/**
 * Export raw analytics data for AI analysis
 */
async function exportData(table, filters = {}) {
  const from = filters.from || '2000-01-01';
  const to = filters.to || '2099-12-31';
  const limit = Math.min(filters.limit || 1000, 10000);
  const validTables = ['analytics_api_calls', 'analytics_ai_costs', 'analytics_client_events', 'analytics_refine_funnels', 'analytics_sessions'];
  if (!validTables.includes(table)) return [];
  const dateCol = table === 'analytics_sessions' ? 'started_at' : 'created_at';
  const result = await db.query(`SELECT * FROM ${table} WHERE ${dateCol} BETWEEN $1 AND $2 ORDER BY ${dateCol} DESC LIMIT $3`, [from, to, limit]);
  return result.rows;
}

module.exports = { middleware, trackAiCost, trackClientEvents, trackRefineFunnel, getDashboard, exportData };
