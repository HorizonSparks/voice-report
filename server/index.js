require('dotenv').config({ override: true });
const rateLimit = require('express-rate-limit');

// Rate limiters — protect against brute force and cost abuse
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 AI requests per minute per user
  message: { error: 'Too many AI requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.auth ? req.auth.person_id : req.ip,
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 uploads per minute
  message: { error: 'Too many uploads. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.auth ? req.auth.person_id : req.ip,
});
const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const analytics = require('../database/analytics');
const knowledgeCache = require('./services/ai/knowledgeCache');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure directories exist
['audio', 'photos', 'forms', 'certs', '.challenges', 'message-photos', 'message-audio'].forEach(dir => {
  const p = path.join(__dirname, '..', dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use('/api', analytics.middleware);

// Session auth — loads req.auth from cookie on every request
const { loadSession, tenantFilter, attachCompanyDb } = require('./middleware/sessionAuth');
app.use(loadSession);
app.use(tenantFilter);
app.use(attachCompanyDb);

// Mount routes
app.use('/api/login', loginLimiter);
app.use('/api', require('./routes/auth'));
app.use('/api/templates', require('./routes/templates'));
app.use('/api/people', require('./routes/people'));
app.use('/api/transcribe', aiLimiter);
app.use('/api/structure', aiLimiter);
app.use('/api/converse', aiLimiter);
app.use('/api/refine', aiLimiter);
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
app.use('/api/support', require('./routes/support'));
app.use('/api', require('./routes/files'));

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
  console.log('  Voice Report v2.0');
  console.log('===========================================');
  console.log(`  API Server:  http://localhost:${PORT}`);
  console.log(`  Admin PIN:   ${process.env.ADMIN_PIN ? '****' : 'DEFAULT (change ADMIN_PIN env!)'}`);
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
