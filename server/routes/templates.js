const { Router } = require('express');
const DB = require('../../database/db');
const { requireAuth, requireAdmin } = require('../middleware/sessionAuth');

const router = Router();

// GET templates — auth required (contains role definitions)
router.get('/', requireAuth, async (req, res) => {
  try {
    const templates = (await DB.templates.getAll()).map(t => ({
      id: t.id, template_name: t.template_name, role_level_title: t.role_level_title, trade: t.trade, is_system: t.is_system || 0
    }));
    res.json(templates);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const t = await DB.templates.getById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Template not found' });
    res.json(t);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create/update/delete templates — admin only
router.post('/', requireAdmin, async (req, res) => {
  try {
    const t = req.body;
    if (!t.id) t.id = 'template_' + t.template_name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    t.is_system = 0;
    t.created_by = req.auth?.person_id || 'admin';
    await DB.templates.create(t);
    res.json({ success: true, id: t.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const result = await DB.templates.update(req.params.id, req.body);
    if (!result) return res.status(404).json({ error: 'Template not found' });
    if (result.error) return res.status(403).json(result);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const result = await DB.templates.deleteTemplate(req.params.id);
    if (result.error) return res.status(403).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
