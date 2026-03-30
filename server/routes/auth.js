const { Router } = require('express');
const DB = require('../../database/db');
const { setSessionCookie, clearSessionCookie } = require('../middleware/sessionAuth');

const router = Router();

// POST /api/login — PIN authentication with session creation
router.post('/login', async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'PIN required' });

    const adminPin = process.env.ADMIN_PIN || '12345678';

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

module.exports = router;
