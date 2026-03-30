const { Router } = require('express');
const DB = require('../../database/db');
const {requireAuth, requireRoleLevel, requireSparksEditMode} = require('../middleware/sessionAuth');
const { getActor } = require('../auth/authz');

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const filters = {};
    if (req.query.status) filters.status = req.query.status;
    if (req.query.trade) filters.trade = req.query.trade;
    if (req.query.assigned_to) filters.assigned_to = req.query.assigned_to;
    if (req.query.created_by) filters.created_by = req.query.created_by;
    if (req.companyId) filters.company_id = req.companyId;
    res.json(await (req.db || DB).punchList.getAll(filters));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/person/:person_id', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    // Only self, admin, or supervisor+ can view another person's punch list
    if (actor.person_id !== req.params.person_id && !actor.is_admin && actor.role_level < 3) {
      return res.status(403).json({ error: 'Not authorized to view this punch list' });
    }
    res.json(await (req.db || DB).punchList.getForPerson(req.params.person_id));
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/stats', requireAuth, async (req, res) => {
  try {
    const filters = {};
    if (req.query.trade) filters.trade = req.query.trade;
    if (req.companyId) filters.company_id = req.companyId;
    res.json(await (req.db || DB).punchList.getStats(filters));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create punch item — derive created_by from session
router.post('/', requireAuth, requireSparksEditMode, async (req, res) => {
  try {
    const actor = getActor(req);
    const data = { ...req.body };
    // DERIVE created_by and company_id from session
    data.created_by = actor.person_id;
    if (req.companyId) data.company_id = req.companyId;
    res.json(await (req.db || DB).punchList.create(data));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', requireAuth, requireSparksEditMode, async (req, res) => {
  try {
    const actor = getActor(req);
    // Fetch the item to check ownership
    const item = (await (req.db || DB).db.query('SELECT * FROM punch_items WHERE id = $1', [req.params.id])).rows[0];
    if (!item) return res.status(404).json({ error: 'Punch list item not found' });
    // Only creator, supervisor+, or admin can update
    if (item.created_by !== actor.person_id && !actor.is_admin && actor.role_level < 3) {
      return res.status(403).json({ error: 'Not authorized to update this punch list item' });
    }
    res.json(await (req.db || DB).punchList.update(req.params.id, req.body));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete — supervisor+ only, must be same company
router.delete('/:id', requireAuth, requireSparksEditMode, requireRoleLevel(3), async (req, res) => {
  try {
    const actor = getActor(req);
    const item = (await (req.db || DB).db.query('SELECT * FROM punch_items WHERE id = $1', [req.params.id])).rows[0];
    if (!item) return res.status(404).json({ error: 'Punch list item not found' });
    // Company scoping: if caller has a company, item must belong to same company
    if (req.companyId && item.company_id && item.company_id !== req.companyId && !actor.is_admin) {
      return res.status(403).json({ error: 'Not authorized to delete this punch list item' });
    }
    res.json(await (req.db || DB).punchList.delete(req.params.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
