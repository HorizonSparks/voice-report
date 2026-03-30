const { Router } = require('express');
const DB = require('../../database/db');
const {requireAuth, requireSparksEditMode} = require('../middleware/sessionAuth');
const { getActor } = require('../auth/authz');

const router = Router();

router.post('/', requireAuth, requireSparksEditMode, async (req, res) => {
  try {
    const report = req.body;
    if (!report.id) return res.status(400).json({ error: 'Report must have an id' });
    // ALWAYS derive person_id from session — caller cannot create on behalf of others
    const actor = getActor(req);
    report.person_id = actor.person_id;
    await (req.db || DB).reports.create(report);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    const filters = {};
    if (req.query.person_id) filters.person_id = req.query.person_id;
    if (req.query.trade) filters.trade = req.query.trade;
    // Company isolation — always filter by company
    if (req.companyId) filters.company_id = req.companyId;
    // DERIVE viewer_id from session — never trust client
    // Admin bypasses visibility filter to see all reports
    if (!actor.is_admin) {
      filters.viewer_id = actor.person_id;
    }
    const reports = (await (req.db || DB).reports.getAll(filters)).map(r => ({
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
    // DERIVE viewer_id from session — admin sees all
    const viewerId = actor.is_admin ? null : actor.person_id;
    res.json(await (req.db || DB).reports.search(req.params.query, viewerId, req.companyId));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const r = await (req.db || DB).reports.getById(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    // Company isolation — reject if report belongs to different company
    if (req.companyId && r.company_id && r.company_id !== req.companyId) {
      return res.status(404).json({ error: 'Report not found' });
    }
    // Visibility scope — owner, supervisor (role_level >= 3), or admin
    const actor = getActor(req);
    if (r.person_id !== actor.person_id && !actor.is_admin && actor.role_level < 3) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// Delete a report (owner or admin/supervisor can delete)
router.delete('/:id', requireAuth, requireSparksEditMode, async (req, res) => {
  try {
    const actor = getActor(req);
    let delQuery = 'SELECT * FROM reports WHERE id = $1';
    const delParams = [req.params.id];
    if (req.companyId) { delParams.push(req.companyId); delQuery += ` AND company_id = $${delParams.length}`; }
    const report = (await (req.db || DB).db.query(delQuery, delParams)).rows[0];
    if (!report) return res.status(404).json({ error: 'Report not found' });

    if (report.person_id !== actor.person_id && !actor.is_admin && actor.role_level < 3) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await (req.db || DB).db.query('DELETE FROM reports WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
