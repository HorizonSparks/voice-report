require('dotenv').config({ override: true });
require('./lib/validateEnv').validateEnv();
const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const analytics = require('../database/analytics');
const knowledgeCache = require('./services/ai/knowledgeCache');
const metrics = require('./services/metrics');
const errorTracking = require('./services/errorTracking');
const { requestLogger } = require('./services/logger');

// Initialize error tracking FIRST (before any other code)
errorTracking.initialize();

const app = express();

// Trust proxy configuration — controls how req.ip and req.secure resolve when
// the request comes through Cloudflare/nginx. Env-configurable so a topology
// change doesn't require a code change:
//
//   TRUST_PROXY=1                  one hop (default; matches Cloudflare → app)
//   TRUST_PROXY=2                  two hops (Cloudflare → nginx → app)
//   TRUST_PROXY=loopback           only localhost (development)
//   TRUST_PROXY=1.2.3.4,5.6.7.8/16 explicit CIDR allowlist (most secure)
//   TRUST_PROXY=false              ignore XFF entirely
//
// Wrong value = either spoofed req.ip (too permissive) or req.secure stuck at
// false behind HTTPS proxies (too strict). Affects login rate limit + cookie
// Secure flag.
const trustProxyRaw = process.env.TRUST_PROXY || '1';
const trustProxyParsed = (() => {
  if (trustProxyRaw === 'true' || trustProxyRaw === 'false') return trustProxyRaw === 'true';
  const n = Number(trustProxyRaw);
  return Number.isFinite(n) ? n : trustProxyRaw;
})();
app.set('trust proxy', trustProxyParsed);

// Legacy-domain 301 redirect — sends any request hitting a retired hostname
// to the canonical hostname, preserving path + query string. Configured via env:
//   LEGACY_HOSTS               (CSV, e.g. "voice-report.ai,www.voice-report.ai")
//   CANONICAL_HOST             (e.g. "horizonsparks.com")
// Defaults retire voice-report.ai → horizonsparks.com without needing env vars.
const LEGACY_HOSTS = (process.env.LEGACY_HOSTS || 'voice-report.ai,www.voice-report.ai')
  .split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
const CANONICAL_HOST = (process.env.CANONICAL_HOST || 'horizonsparks.com').trim();
app.use((req, res, next) => {
  const host = (req.headers.host || '').toLowerCase().split(':')[0];
  if (LEGACY_HOSTS.includes(host)) {
    return res.redirect(301, 'https://' + CANONICAL_HOST + req.originalUrl);
  }
  next();
});

const PORT = process.env.PORT || 3000;

// Ensure directories exist
['audio', 'photos', 'forms', 'certs', '.challenges', 'message-photos', 'message-audio'].forEach(dir => {
  const p = path.join(__dirname, '..', dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// CORS — allow LoopFolders (app.horizonsparks.ai) to call Voice Report APIs
const ALLOWED_ORIGINS = [
  'https://app.horizonsparks.ai',
  'http://localhost:3032',
  'http://localhost:3033',
];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Integration-Key');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Prometheus metrics endpoint — restricted to internal Docker network / localhost
app.get('/metrics', (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || '';
  const allowed = ip === '127.0.0.1' || ip === '::1' || ip.startsWith('172.') || ip.startsWith('10.') || ip === '::ffff:127.0.0.1';
  if (!allowed) return res.status(403).json({ error: 'Forbidden' });
  next();
}, metrics.metricsHandler);

// Metrics middleware (correlation IDs + request tracking)
app.use(metrics.metricsMiddleware);

// Structured request logging (Pino JSON → Promtail → Loki)
app.use(requestLogger);

// Middleware
// === STRIPE WEBHOOK (2026-05-15) ===
// MUST be mounted before express.json — webhook needs the raw request body
// for signature verification. Its own router uses express.raw() internally.
const { buildStripeWebhookRouter } = require("./routes/billing_stripe");
app.use("/api/billing/webhook", buildStripeWebhookRouter());

app.use(express.json({ limit: '50mb' }));
app.use('/api', analytics.middleware);

// Session auth — loads req.auth from cookie on every request
const { loadSession, tenantFilter, attachCompanyDb } = require('./middleware/sessionAuth');
const { verifyKeycloakJwt } = require('./middleware/verifyKeycloakJwt');
app.use(loadSession);
// Keycloak JWT auth — additive. If Authorization: Bearer <jwt> is present and
// verifies, JWT-derived identity OVERRIDES whatever loadSession populated
// (cookie or integration key). If absent, this middleware is a no-op. If
// present but invalid, returns 401 instead of falling through to weaker auth.
// Mount AFTER loadSession so we can override; BEFORE tenant/company guards.
app.use(verifyKeycloakJwt());
app.use(tenantFilter);
app.use(attachCompanyDb);


// ---- AI API COST GUARD ----
// Global per-user rate limit on ALL AI-calling endpoints
// 60 AI calls per 10 minutes per user (covers agent, refine, structure, converse)
const aiCallsMap = new Map(); // personId -> { count, resetAt }
const AI_CALLS_LIMIT = 60;
const AI_CALLS_WINDOW = 10 * 60 * 1000; // 10 minutes

function aiCostGuard(req, res, next) {
  if (!req.auth) return next(); // unauthenticated routes handle their own auth
  const userId = req.auth.person_id || req.auth.sessionId || 'anon';
  const now = Date.now();
  let entry = aiCallsMap.get(userId);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + AI_CALLS_WINDOW };
    aiCallsMap.set(userId, entry);
  }
  entry.count++;
  if (entry.count > AI_CALLS_LIMIT) {
    const waitMin = Math.ceil((entry.resetAt - now) / 60000);
    return res.status(429).json({ error: 'AI rate limit reached (' + AI_CALLS_LIMIT + ' calls per 10 min). Try again in ' + waitMin + ' min.' });
  }
  next();
}

// Cleanup every 30 min
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of aiCallsMap) {
    if (now > entry.resetAt + AI_CALLS_WINDOW) aiCallsMap.delete(id);
  }
}, 30 * 60 * 1000);

// Mount routes
// AI cost guard + per-user rate limit on AI-heavy routes. Cost guard caps
// $/day spend; rate limiter caps request frequency. Both needed — a runaway
// agent loop can spike spend before tripping the daily ceiling.
const { aiHeavyLimiter, webauthnLimiter } = require('./middleware/rateLimiters');
app.use('/api/agent', aiCostGuard, aiHeavyLimiter);
app.use('/api/loopfolders/intelligence', aiCostGuard, aiHeavyLimiter);
app.use('/api/structure', aiCostGuard, aiHeavyLimiter);
app.use('/api/refine', aiCostGuard, aiHeavyLimiter);
app.use('/api/converse', aiCostGuard, aiHeavyLimiter);
app.use('/api/refine-speak', aiCostGuard, aiHeavyLimiter);

app.use('/api', require('./routes/auth'));
app.use('/api/templates', require('./routes/templates'));
app.use('/api/people', require('./routes/people'));
app.use('/api', require('./routes/ai'));
app.use('/api', require('./routes/messages'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/forms', require('./routes/formsV2'));  // Must be before old forms route — has /templates, /submissions
app.use('/api/forms', require('./routes/forms'));    // Old forms route has /:id catch-all
app.use('/api/daily-plans', require('./routes/dailyPlans'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/jsa', require('./routes/jsa')(require('../database/db').db));
app.use('/api/punch-list', require('./routes/punchList'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/webauthn', webauthnLimiter, require('./routes/webauthn'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/sparks', require('./routes/sparks'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api', require('./routes/files'));
app.use('/api/folders', require('./routes/sharedFolders'));
// Keycloak SSO redirect/callback routes (additive — PIN flow at /api/auth/login still works)
app.use('/auth/sso', require('./routes/sso'));
app.use('/api/loopfolders/intelligence', require('./routes/loopfolders-intelligence'));
app.use('/api/agent', require('./routes/agent'));
app.use('/api/support', require('./routes/support'));
app.use('/api/ppe', require('./routes/ppe'));

// Grafana reverse proxy — authenticated, Sparks role required, streamed responses
const GRAFANA_INTERNAL = process.env.GRAFANA_URL || 'http://grafana:3000';
const { Readable } = require('stream');
app.use('/grafana', (req, res, next) => {
  // Access control: SystemHealthPanel (Sparks-only component) is the UI gate.
  // Grafana has anonymous viewer access (GF_AUTH_ANONYMOUS_ENABLED=true).
  // Proxy only limits HTTP methods — no session required for iframe embeds.
  if (!['GET', 'HEAD', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  next();
}, async (req, res) => {
  try {
    const url = GRAFANA_INTERNAL + '/grafana' + req.url;
    // Forward necessary headers
    const fwdHeaders = { host: 'grafana:3000', accept: req.headers.accept || '*/*' };
    if (req.headers['accept-encoding']) fwdHeaders['accept-encoding'] = req.headers['accept-encoding'];
    if (req.headers['content-type']) fwdHeaders['content-type'] = req.headers['content-type'];
    // Build fetch options — include body for POST requests
    const fetchOpts = { method: req.method, headers: fwdHeaders, redirect: 'follow' };
    if (req.method === 'POST' && req.body) fetchOpts.body = JSON.stringify(req.body);
    const r = await fetch(url, fetchOpts);
    res.status(r.status);
    r.headers.forEach((v, k) => {
      if (!['transfer-encoding', 'connection'].includes(k.toLowerCase())) {
        res.setHeader(k, v);
      }
    });
    // Stream response instead of buffering
    Readable.fromWeb(r.body).pipe(res);
  } catch (e) {
    res.status(502).json({ error: 'Grafana unavailable' });
  }
});

// Error tracking middleware (AFTER all routes — catches unhandled errors)
app.use(errorTracking.errorHandler);

// Unknown /api/* paths must return JSON 404, not the SPA index.html.
// Placed BEFORE the static handler so unknown API paths never fall through.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

// In production, serve built client files
// In dev mode, Vite handles the client
const distPath = path.join(__dirname, '..', 'dist');
const clientPath = path.join(__dirname, '..', 'client');

if (fs.existsSync(distPath)) {
  // Service worker must be served from root with correct headers
  app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(distPath, 'sw.js'));
  });

  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  // Fallback: serve old client directory (for backwards compatibility)
  app.use(express.static(clientPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientPath, 'index.html'));
  });
}

// Start servers
// Preload knowledge cache on startup
knowledgeCache.initialize();

// Periodic session cleanup — purge expired sessions every hour
const DB_SESSIONS = require('../database/db');
setInterval(async () => {
  try {
    const count = await DB_SESSIONS.sessions.deleteExpired();
    if (count > 0) console.log('[sessions] Cleaned up ' + count + ' expired sessions');
  } catch (e) {
    console.error('[sessions] Cleanup error:', e.message);
  }
}, 60 * 60 * 1000); // Every hour
// Run once on startup after 30 seconds
setTimeout(async () => {
  try {
    const count = await DB_SESSIONS.sessions.deleteExpired();
    if (count > 0) console.log('[sessions] Startup cleanup: ' + count + ' expired sessions removed');
  } catch (e) {}
}, 30 * 1000);


app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('===========================================');
  console.log('  Voice Report v2.0 + Observability');
  console.log('===========================================');
  console.log(`  API Server:  http://localhost:${PORT}`);
  console.log(`  Metrics:     http://localhost:${PORT}/metrics`);
  console.log(`  Admin PIN:   ${process.env.ADMIN_PIN ? '****' : 'DEFAULT (change ADMIN_PIN env!)'}`);
  console.log(`  GlitchTip:   ${process.env.SENTRY_DSN_BACKEND ? 'OK' : 'NOT CONFIGURED'}`);
  console.log(`  Anthropic:   ${process.env.ANTHROPIC_API_KEY ? 'OK' : 'MISSING'}`);
  console.log(`  OpenAI:      ${process.env.OPENAI_API_KEY ? 'OK' : 'MISSING'}`);
  console.log('===========================================');
  if (fs.existsSync(distPath)) {
    console.log('  Serving built client from dist/');
  } else {
    console.log('  Dev mode: run "npm run dev:client" for Vite');
  }
  console.log('===========================================');
});

const HTTPS_PORT = process.env.HTTPS_PORT || (parseInt(PORT) + 443);
const certPath = path.join(__dirname, '..', 'cert.pem');
const keyPath = path.join(__dirname, '..', 'key.pem');

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, app)
    .listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log(`  HTTPS:       https://192.168.1.137:${HTTPS_PORT}`);
      console.log('===========================================');
    });
}
