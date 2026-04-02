require('dotenv').config({ override: true });
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
const PORT = process.env.PORT || 3000;

// Ensure directories exist
['audio', 'photos', 'forms', 'certs', '.challenges', 'message-photos', 'message-audio'].forEach(dir => {
  const p = path.join(__dirname, '..', dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
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
app.use(express.json({ limit: '50mb' }));
app.use('/api', analytics.middleware);

// Session auth — loads req.auth from cookie on every request
const { loadSession, tenantFilter, attachCompanyDb } = require('./middleware/sessionAuth');
app.use(loadSession);
app.use(tenantFilter);
app.use(attachCompanyDb);

// Mount routes
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
app.use('/api/webauthn', require('./routes/webauthn'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/sparks', require('./routes/sparks'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api', require('./routes/files'));
app.use('/api/folders', require('./routes/sharedFolders'));
app.use('/api/agent', require('./routes/agent'));

// Grafana reverse proxy — authenticated, Sparks role required, streamed responses
const GRAFANA_INTERNAL = process.env.GRAFANA_URL || 'http://grafana:3000';
const { Readable } = require('stream');
app.use('/grafana', (req, res, next) => {
  // Gate: require authenticated Sparks user (admin or support)
  if (!req.auth?.sparks_role || !['admin', 'support'].includes(req.auth.sparks_role)) {
    return res.status(403).json({ error: 'Sparks role required' });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Only GET allowed' });
  }
  next();
}, async (req, res) => {
  try {
    const url = GRAFANA_INTERNAL + '/grafana' + req.url;
    // Strip sensitive headers before forwarding
    const fwdHeaders = { host: 'grafana:3000', accept: req.headers.accept || '*/*' };
    if (req.headers['accept-encoding']) fwdHeaders['accept-encoding'] = req.headers['accept-encoding'];
    const r = await fetch(url, { headers: fwdHeaders, redirect: 'follow' });
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
