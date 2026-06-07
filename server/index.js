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
// AI guards on Claude-calling routes, in this order:
//   1. aiCostGuard         — per-user request rate (60 calls / 10 min)
//   2. aiBudgetGuard       — per-company daily USD cap (env-configurable)
//   3. aiHeavyLimiter      — per-user min/max per minute (lower-level burst)
// Each is independent — failing any of them returns a 429 without reaching the route.
const { aiHeavyLimiter, webauthnLimiter } = require('./middleware/rateLimiters');
const { aiBudgetGuard } = require('./middleware/aiBudgetGuard');
app.use('/api/agent', aiCostGuard, aiBudgetGuard, aiHeavyLimiter);
app.use('/api/loopfolders/intelligence', aiCostGuard, aiBudgetGuard, aiHeavyLimiter);
app.use('/api/structure', aiCostGuard, aiBudgetGuard, aiHeavyLimiter);
app.use('/api/refine', aiCostGuard, aiBudgetGuard, aiHeavyLimiter);
app.use('/api/converse', aiCostGuard, aiBudgetGuard, aiHeavyLimiter);
app.use('/api/refine-speak', aiCostGuard, aiBudgetGuard, aiHeavyLimiter);

app.use('/api', require('./routes/auth'));
app.use('/api/templates', require('./routes/templates'));
app.use('/api/people', require('./routes/people'));
app.use('/api', require('./routes/ai'));
app.use('/api', require('./routes/messages'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/safety-observations', require('./routes/safetyObservations'));
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
app.use('/api/ceo', require('./routes/ceo'));  // CEO Control Center — per-company admin window (role>=6), walled from /api/sparks
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
app.use('/api/push', require('./routes/push'));

// Isolation routing health — answered BY the running server, so it reflects the REAL in-process
// company→DB map (a throwaway `node` process always shows empty — the artifact that misled the
// 2026-06-06 diagnosis). Polled by the isolation-canary every few minutes. Returns 503 when
// isolation is ON but the loaded map does NOT cover every registered company (silent fallback to
// shared), the registry is unreadable, or the degraded flag is set. Booleans only — no company
// counts — safe to answer unauthenticated. MUST stay before the '/api' 404 catch-all below.
app.get('/api/health/isolation', async (req, res) => {
  try {
    const poolRouter = require('../database/pool-router');
    const useCompanyDbs = process.env.USE_COMPANY_DBS === 'true';
    const mapSize = Object.keys(poolRouter.getCompanyDbMap()).length;
    let registeredCount = -1; // -1 = registry unreadable (a real failure, NOT a legit empty)
    try {
      const r = await poolRouter.getSharedPool()
        .query('SELECT COUNT(*)::int AS c FROM voicereport.company_databases');
      registeredCount = r.rows[0].c;
    } catch (e) {
      if (e && e.code === '42P01') registeredCount = 0; // registry table absent → legit 0
    }
    const degraded = global.__ISOLATION_DEGRADED__ === true;
    const ok = !useCompanyDbs || (registeredCount >= 0 && mapSize >= registeredCount && !degraded);
    if (!ok) {
      console.warn(`[health/isolation] NOT OK — mapSize=${mapSize} registered=${registeredCount} degraded=${degraded}`);
    }
    return res.status(ok ? 200 : 503).json({ ok, degraded, useCompanyDbs });
  } catch (e) {
    // Fail closed + keep the boolean contract consistent: if the probe itself can't run, we
    // cannot confirm isolation health, so report not-ok (the canary will alarm).
    console.error('[health/isolation] probe error:', e && e.message);
    return res.status(503).json({ ok: false, degraded: true, useCompanyDbs: process.env.USE_COMPANY_DBS === 'true' });
  }
});

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


// Load the per-company DB registry at startup — ROBUSTLY.
//
// A silent failure here is a SECURITY event: an empty map makes every company
// fall back to the SHARED database (physical isolation OFF) with no error and no
// alarm. Root cause of the 2026-06-06 "Tommy silently routed to shared" incident
// was THIS call being fire-and-forget with a swallowed catch and no retry — one
// boot hiccup (DB not ready for that single instant during a restart) stranded
// the map empty for the whole process lifetime. So now: retry with backoff,
// verify the loaded count matches the registry, log LOUDLY (never swallow), set a
// degraded marker the health probe can read, and re-assert periodically.
// refreshCompanyDbMap() now THROWS on a real failure (connection/auth/timeout) and
// RESOLVES only on genuine success — returning the company count, with a missing
// registry table treated as a legitimate 0. So "resolved" == truly loaded, and we
// can retry/alarm honestly. (Codex caught that the prior version's success check was
// unsound because the function used to swallow errors and return a count.)
(async function loadCompanyDbMapRobustly() {
  const router = require('../database/pool-router');
  const wantIsolation = process.env.USE_COMPANY_DBS === 'true';
  const MAX_ATTEMPTS = 12;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const loaded = await router.refreshCompanyDbMap(); // throws on real failure
      console.log(`[company-dbs] map loaded: ${loaded} dedicated database(s)`);
      global.__ISOLATION_DEGRADED__ = false; // genuine success (a throw would skip this line)
      return;
    } catch (e) {
      console.error(`[company-dbs] load attempt ${attempt}/${MAX_ATTEMPTS} FAILED: ${e.message}`);
      if (attempt === MAX_ATTEMPTS) {
        global.__ISOLATION_DEGRADED__ = wantIsolation;
        console.error('[company-dbs] 🚨 ISOLATION DEGRADED — per-company DB map did not load; '
          + 'provisioned companies will FALL BACK TO THE SHARED DATABASE. Investigate immediately.');
      } else {
        await new Promise((res) => setTimeout(res, Math.min(1000 * attempt, 8000)));
      }
    }
  }
})();

// Re-assert periodically so a transient can NEVER permanently strand the map.
// Overlap-safe (skips if a prior refresh is still in flight), and the degraded flag
// moves ONLY on a genuine resolve (cleared) or a genuine throw (set) — never on a
// swallowed/false-healthy result.
let __companyDbReassertInFlight = false;
setInterval(async () => {
  if (__companyDbReassertInFlight) return;
  __companyDbReassertInFlight = true;
  try {
    await require('../database/pool-router').refreshCompanyDbMap(); // throws on real failure
    global.__ISOLATION_DEGRADED__ = false; // genuine success
  } catch (_) {
    if (process.env.USE_COMPANY_DBS === 'true') global.__ISOLATION_DEGRADED__ = true;
  } finally {
    __companyDbReassertInFlight = false;
  }
}, 5 * 60 * 1000);

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
