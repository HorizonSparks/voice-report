const { Router } = require('express');
const DB = require('../../database/db');
const { setSessionCookie, clearSessionCookie } = require('../middleware/sessionAuth');
const { loginLimiter } = require('../middleware/rateLimiters');

const router = Router();

// POST /api/login — PIN authentication with session creation. The login
// limiter (5 failed attempts / 5 min / IP, configured in middleware/
// rateLimiters.js with skipSuccessfulRequests=true) replaces the previous
// hand-rolled in-memory limiter — same behavior, standard RateLimit-*
// headers, one source of truth.
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'PIN required' });

    const adminPin = process.env.ADMIN_PIN;
    if (!adminPin) return res.status(503).json({ error: 'Server misconfigured: ADMIN_PIN not set' });

    if (pin === adminPin) {
      // Admin login — use sentinel admin ID (avoids null person_id edge cases)
      const ADMIN_ID = '__admin__';
      const session = await DB.sessions.create({
        person_id: ADMIN_ID,
        is_admin: true,
        role_level: 5,
        trade: null,
        company_id: 'company_horizon_sparks',
        sparks_role: 'admin',
        user_agent: req.headers['user-agent'],
        ip_address: req.ip,
      });
      setSessionCookie(res, session.id, undefined, req);
      return res.json({
        is_admin: true,
        person_id: ADMIN_ID,
        name: 'Admin',
        role_title: 'Administrator',
        company_id: 'company_horizon_sparks',
        sparks_role: 'admin',
        session_id: session.id,
      });
    }

    const person = await DB.people.getByPin(pin);
    if (person) {
      // Person login — create session with company_id and sparks_role
      const session = await DB.sessions.create({
        person_id: person.id,
        is_admin: false,
        role_level: person.role_level || 1,
        trade: person.trade || null,
        company_id: person.company_id || null,
        sparks_role: person.sparks_role || null,
        user_agent: req.headers['user-agent'],
        ip_address: req.ip,
      });
      setSessionCookie(res, session.id, undefined, req);
      return res.json({
        is_admin: false,
        person_id: person.id,
        name: person.name,
        role_title: person.role_title,
        role_level: person.role_level || 1,
        template_id: person.template_id,
        trade: person.trade || '',
        photo: person.photo || null,
        supervisor_id: person.supervisor_id || null,
        company_id: person.company_id || null,
        sparks_role: person.sparks_role || null,
        session_id: session.id,
      });
    }

    res.status(401).json({ error: 'PIN not recognized' });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/logout — destroy session and clear cookie
router.post('/logout', async (req, res) => {
  try {
    if (req.auth && req.auth.sessionId) {
      await DB.sessions.delete(req.auth.sessionId);
    }
    clearSessionCookie(res, req);
    res.json({ success: true });
  } catch (err) {
    clearSessionCookie(res, req);
    res.json({ success: true }); // Always succeed on logout
  }
});

// GET /api/me — return current session user info
router.get('/me', async (req, res) => {
  if (!req.auth) return res.status(401).json({ error: 'Not authenticated' });

  if (req.auth.is_admin && (req.auth.person_id === '__admin__' || !req.auth.person_id)) {
    return res.json({
      is_admin: true,
      person_id: '__admin__',
      name: 'Admin',
      role_title: 'Administrator',
      role_level: 5,
      company_id: 'company_horizon_sparks',
      sparks_role: 'admin',
    });
  }

  try {
    const person = await DB.people.getById(req.auth.person_id);
    if (!person) return res.status(401).json({ error: 'Session user not found' });
    return res.json({
      is_admin: req.auth.is_admin,
      person_id: person.id,
      name: person.name,
      role_title: person.role_title,
      role_level: person.role_level || 1,
      template_id: person.template_id,
      trade: person.trade || '',
      photo: person.photo || null,
      supervisor_id: person.supervisor_id || null,
      company_id: person.company_id || null,
      sparks_role: person.sparks_role || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/whoami — debug-friendly view of CURRENT auth state.
// Reports source (cookie vs integration_key vs keycloak_jwt vs unauthenticated),
// resolved person_id, and presence flags. Useful for verifying SSO end-to-end
// once Keycloak client secret is in place.
router.get('/auth/whoami', (req, res) => {
  const hasCookie = Boolean((req.headers.cookie || '').match(/(^|;\s*)hs_session=/));
  const hasBearer = /^bearer\s/i.test(req.headers.authorization || req.headers.Authorization || '');
  const hasIntegrationKey = Boolean(req.headers['x-integration-key']);

  let source = 'unauthenticated';
  if (req.auth) {
    if (req.auth.source === 'keycloak_jwt') source = 'keycloak_jwt';
    else if (req.auth.isIntegration) source = 'integration_key';
    else if (req.auth.sessionId) source = 'cookie_session';
    else source = 'unknown';
  }

  res.json({
    authenticated: Boolean(req.auth),
    source,
    person_id: req.auth?.person_id || null,
    name: req.auth?.name || null,
    role_level: req.auth?.role_level ?? null,
    sparks_role: req.auth?.sparks_role || null,
    company_id: req.auth?.company_id || null,
    is_admin: Boolean(req.auth?.is_admin),
    keycloak_user_id: req.auth?.keycloak_user_id || null,
    keycloak_username: req.auth?.keycloak_username || null,
    request_signals: {
      has_session_cookie: hasCookie,
      has_bearer_token: hasBearer,
      has_integration_key: hasIntegrationKey,
    },
  });
});

module.exports = router;
