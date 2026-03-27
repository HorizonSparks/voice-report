const { Router } = require('express');
const DB = require('../../database/db');
const { requireAuth } = require('../middleware/sessionAuth');
const { getActor } = require('../auth/authz');

const router = Router();

router.post('/', requireAuth, async (req, res) => {
  try {
    const report = req.body;
    if (!report.id) return res.status(400).json({ error: 'Report must have an id' });
    // Derive person_id from session if not explicitly set
    const actor = getActor(req);
    if (!report.person_id && actor.person_id) report.person_id = actor.person_id;
    await DB.reports.create(report);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    const filters = {};
    if (req.query.person_id) filters.person_id = req.query.person_id;
    if (req.query.trade) filters.trade = req.query.trade;
    // DERIVE viewer_id from session — never trust client
    filters.viewer_id = actor.is_admin ? (req.query.viewer_id || actor.person_id) : actor.person_id;
    const reports = (await DB.reports.getAll(filters)).map(r => ({
      id: r.id, person_id: r.person_id, person_name: r.person_name, role_title: r.role_title,
      created_at: r.created_at, duration_seconds: r.duration_seconds, transcript_raw: r.transcript_raw,
      preview: r.transcript_raw ? r.transcript_raw.substring(0, 100) : '', status: r.status,
    }));
    res.json(reports);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/search/:query', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    // DERIVE viewer_id from session
    const viewerId = actor.is_admin ? (req.query.viewer_id || actor.person_id) : actor.person_id;
    res.json(await DB.reports.search(req.params.query, viewerId));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const r = await DB.reports.getById(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
