const { Router } = require('express');
const DB = require('../../database/db');
const { requireAuth, requireRoleLevel } = require('../middleware/sessionAuth');
const { getActor } = require('../auth/authz');

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const filters = {};
    if (req.query.status) filters.status = req.query.status;
    if (req.query.trade) filters.trade = req.query.trade;
    if (req.query.assigned_to) filters.assigned_to = req.query.assigned_to;
    if (req.query.created_by) filters.created_by = req.query.created_by;
    res.json(await DB.punchList.getAll(filters));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/person/:person_id', requireAuth, async (req, res) => {
  try { res.json(await DB.punchList.getForPerson(req.params.person_id)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/stats', requireAuth, async (req, res) => {
  try {
    const filters = {};
    if (req.query.trade) filters.trade = req.query.trade;
    res.json(await DB.punchList.getStats(filters));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create punch item — derive created_by from session
router.post('/', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    const data = { ...req.body };
    // DERIVE created_by from session
    if (!data.created_by) data.created_by = actor.person_id;
    res.json(await DB.punchList.create(data));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', requireAuth, async (req, res) => {
  try { res.json(await DB.punchList.update(req.params.id, req.body)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete — supervisor+ only
router.delete('/:id', requireAuth, requireRoleLevel(3), async (req, res) => {
  try { res.json(await DB.punchList.delete(req.params.id)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
