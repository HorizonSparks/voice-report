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
// AI / ANTHROPIC METRICS
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
// AGENT METRICS
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
function normalizeRoute(path) {
  if (!path) return 'unknown';
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d+/g, '/:id')
    .replace(/\/person_[a-z_]+/g, '/:person_id')
    .replace(/\?.*/g, '');
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
    const route = normalizeRoute(req.route?.path || req.path);
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
  anthropicRequestsTotal,
  anthropicTokensTotal,
  anthropicCostTotal,
  anthropicRequestDuration,
  agentToolCallsTotal,
  agentSessionsTotal,
  agentToolLoopsExhausted,
  dbPoolSize,
  dbErrorsTotal,
};
