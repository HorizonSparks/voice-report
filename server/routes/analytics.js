const { Router } = require('express');
const analytics = require('../../database/analytics');
const { requireAuth, requireAdmin } = require('../middleware/sessionAuth');

const router = Router();

// POST /events — track client events (any authenticated user)
router.post('/events', requireAuth, async (req, res) => {
  try {
    const { session_id, person_id, events } = req.body;
    if (!session_id || !events || !Array.isArray(events)) return res.status(400).json({ error: 'Invalid payload' });
    await analytics.trackClientEvents(session_id, person_id, events);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /dashboard — admin only
router.get('/dashboard', requireAdmin, async (req, res) => {
  try {
    const { from, to, person_id, company_id } = req.query;
    res.json(await analytics.getDashboard({ from, to, person_id, company_id }));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /ai-costs — admin only
router.get('/ai-costs', requireAdmin, async (req, res) => {
  try {
    const { from, to } = req.query;
    res.json(await analytics.exportData('analytics_ai_costs', { from, to, limit: 500 }));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /export — admin only
router.get('/export', requireAdmin, async (req, res) => {
  try {
    const { table, from, to, limit } = req.query;
    if (!table) return res.status(400).json({ error: 'table parameter required' });
    res.json(await analytics.exportData(table, { from, to, limit: parseInt(limit) || 1000 }));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
