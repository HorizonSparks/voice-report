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

// GET /ai-spending — AI cost dashboard for Control Center
router.get('/ai-spending', requireAdmin, async (req, res) => {
  try {
    const db = require('../../database/db').db;
    const [totals, byService, byDay, byUser] = await Promise.all([
      db.query(`SELECT SUM(estimated_cost_cents)::int as total_cost_cents, COUNT(*)::int as total_calls,
        SUM(input_tokens)::int as total_input, SUM(output_tokens)::int as total_output
        FROM analytics_ai_costs`),
      db.query(`SELECT provider, service, COUNT(*)::int as calls,
        SUM(input_tokens)::int as input_tokens, SUM(output_tokens)::int as output_tokens,
        SUM(estimated_cost_cents)::int as cost_cents
        FROM analytics_ai_costs GROUP BY provider, service ORDER BY cost_cents DESC`),
      db.query(`SELECT DATE(created_at) as day, COUNT(*)::int as calls,
        SUM(estimated_cost_cents)::int as cost_cents
        FROM analytics_ai_costs GROUP BY day ORDER BY day DESC LIMIT 14`),
      db.query(`SELECT a.person_id,
        COALESCE(p.name, 'Deleted user') as person_name,
        COUNT(*)::int as calls,
        SUM(a.estimated_cost_cents)::int as cost_cents
        FROM analytics_ai_costs a
        LEFT JOIN voicereport.people p ON p.id = a.person_id
        WHERE a.person_id IS NOT NULL
        GROUP BY a.person_id, p.name ORDER BY cost_cents DESC LIMIT 10`),
    ]);
    res.json({
      ...totals.rows[0],
      by_service: byService.rows,
      by_day: byDay.rows.reverse(),
      by_user: byUser.rows,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
