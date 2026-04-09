/**
 * Prometheus Metrics Module — Horizon Sparks Observability
 * Exposes horizon_* metrics for Prometheus scraping.
 * Includes correlation ID generation for request tracing.
 */
const client = require('prom-client');
const { randomUUID } = require('crypto');

// Collect default Node.js metrics (GC, event loop, memory)
client.collectDefaultMetrics({ prefix: 'horizon_nodejs_' });

// ============================================
// HTTP METRICS
// ============================================
const httpRequestsTotal = new client.Counter({
  name: 'horizon_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

const httpRequestDuration = new client.Histogram({
  name: 'horizon_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
});

const httpRequestsInFlight = new client.Gauge({
  name: 'horizon_http_requests_in_flight',
  help: 'Number of HTTP requests currently being processed',
});

// ============================================
// AI / ANTHROPIC METRICS (legacy — kept for backward compatibility)
// ============================================
const anthropicRequestsTotal = new client.Counter({
  name: 'horizon_anthropic_requests_total',
  help: 'Total Anthropic API requests',
  labelNames: ['service', 'model', 'success'],
});

const anthropicTokensTotal = new client.Counter({
  name: 'horizon_anthropic_tokens_total',
  help: 'Total tokens used in Anthropic API calls',
  labelNames: ['model', 'direction'],
});

const anthropicCostTotal = new client.Counter({
  name: 'horizon_anthropic_cost_usd_total',
  help: 'Total AI cost in USD',
  labelNames: ['service'],
});

const anthropicRequestDuration = new client.Histogram({
  name: 'horizon_anthropic_request_duration_seconds',
  help: 'Anthropic API request duration in seconds',
  labelNames: ['service', 'model'],
  buckets: [0.5, 1, 2, 5, 10, 20, 30, 60],
});

// ============================================
// AGENT METRICS (chat orchestrator — existing)
// ============================================
const agentToolCallsTotal = new client.Counter({
  name: 'horizon_agent_tool_calls_total',
  help: 'Total agent tool calls',
  labelNames: ['tool_name', 'success'],
});

const agentSessionsTotal = new client.Counter({
  name: 'horizon_agent_sessions_total',
  help: 'Total agent chat sessions',
  labelNames: ['model_tier'],
});

const agentToolLoopsExhausted = new client.Counter({
  name: 'horizon_agent_tool_loops_exhausted_total',
  help: 'Number of times agent hit max tool loop iterations',
});

// ============================================
// AGENT RUNTIME METRICS (Phase 1 — agent-definition layer)
// New parallel counters. Do NOT mutate labels on the anthropic* counters above
// (prom-client throws on label redefinition after registration).
// ============================================
const agentRequestsTotal = new client.Counter({
  name: 'horizon_agent_requests_total',
  help: 'Total runAgent() invocations, labeled by agent_name',
  labelNames: ['agent_name', 'model', 'success'],
});

const agentTokensTotal = new client.Counter({
  name: 'horizon_agent_tokens_total',
  help: 'Total tokens consumed by agent invocations, labeled by agent_name',
  labelNames: ['agent_name', 'model', 'direction'],
});

// Stored in integer cents to avoid float drift across billions of increments.
// Label is agent_name ONLY — project_id would be unbounded cardinality in Prometheus
// (customers churn). Per-project billing attribution is handled in analytics_ai_costs DB table,
// which is the authoritative source for Stripe billing queries.
const agentCostTotalCents = new client.Counter({
  name: 'horizon_agent_cost_cents_total',
  help: 'Total agent cost in integer cents, labeled by agent_name',
  labelNames: ['agent_name'],
});

const agentGuardrailViolationsTotal = new client.Counter({
  name: 'horizon_agent_guardrail_violations_total',
  help: 'Guardrail violations (disabled, cost_limit, pii_observed, etc.) labeled by agent_name',
  labelNames: ['agent_name', 'guardrail_type'],
});

const agentCostOverrunsTotal = new client.Counter({
  name: 'horizon_agent_cost_overruns_total',
  help: 'Number of times actual call cost exceeded 2x the declared costLimitPerCallCents',
  labelNames: ['agent_name'],
});

// ============================================
// DATABASE METRICS
// ============================================
const dbPoolSize = new client.Gauge({
  name: 'horizon_db_pool_size',
  help: 'Database connection pool size',
  labelNames: ['state'],
});

const dbErrorsTotal = new client.Counter({
  name: 'horizon_db_errors_total',
  help: 'Total database errors',
});

// ============================================
// ROUTE NORMALIZATION (prevent label cardinality explosion)
// ============================================
function normalizeRoute(routeTemplate, rawPath) {
  // Prefer Express route template (bounded cardinality)
  if (routeTemplate) {
    return routeTemplate
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
      .replace(/\/\d+/g, '/:id')
      .replace(/\/person_[a-z_]+/g, '/:person_id')
      .replace(/\?.*/g, '');
  }
  // No route template — collapse to prevent label explosion
  if (!rawPath || !rawPath.startsWith('/api')) return 'unmatched';
  const parts = rawPath.replace(/\?.*/, '').split('/').filter(Boolean);
  if (parts.length <= 2) return '/' + parts.join('/');
  return '/' + parts.slice(0, 2).join('/') + '/*';
}

// ============================================
// EXPRESS MIDDLEWARE
// ============================================
function metricsMiddleware(req, res, next) {
  // Generate correlation ID for request tracing
  req.correlationId = req.headers['x-correlation-id'] || randomUUID();
  res.setHeader('x-correlation-id', req.correlationId);

  // Skip /metrics endpoint itself
  if (req.path === '/metrics') return next();

  const start = process.hrtime.bigint();
  httpRequestsInFlight.inc();

  const onFinish = () => {
    httpRequestsInFlight.dec();
    const duration = Number(process.hrtime.bigint() - start) / 1e9;
    const route = normalizeRoute(req.route?.path, req.path);
    const labels = { method: req.method, route, status_code: res.statusCode };
    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, duration);
    res.removeListener('finish', onFinish);
  };
  res.on('finish', onFinish);
  next();
}

// ============================================
// METRICS ENDPOINT HANDLER
// ============================================
async function metricsHandler(req, res) {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
}

module.exports = {
  metricsMiddleware,
  metricsHandler,
  // Legacy anthropic metrics (callClaude still writes these)
  anthropicRequestsTotal,
  anthropicTokensTotal,
  anthropicCostTotal,
  anthropicRequestDuration,
  // Existing agent chat orchestrator metrics
  agentToolCallsTotal,
  agentSessionsTotal,
  agentToolLoopsExhausted,
  // NEW Phase 1 agent-runtime metrics
  agentRequestsTotal,
  agentTokensTotal,
  agentCostTotalCents,
  agentGuardrailViolationsTotal,
  agentCostOverrunsTotal,
  // DB
  dbPoolSize,
  dbErrorsTotal,
};
