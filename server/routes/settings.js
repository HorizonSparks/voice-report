const { Router } = require('express');
const DB = require('../../database/db');
const { requireAuth, requireAdmin } = require('../middleware/sessionAuth');

const router = Router();

// GET /api/settings — fetch company settings (public — needed for login screen logo)
router.get('/', async (req, res) => {
  try {
    const result = await DB.db.query('SELECT * FROM voicereport.company_settings WHERE id = 1');
    res.json(result.rows[0] || { id: 1, company_name: 'Horizon Sparks', logo_data: null });
  } catch (e) {
    console.error('Settings GET error:', e);
    res.json({ id: 1, company_name: 'Horizon Sparks', logo_data: null });
  }
});

// PUT /api/settings — update company name and/or logo (admin only)
router.put('/', requireAdmin, async (req, res) => {
  try {
    const { company_name, logo_data, logo_filename } = req.body;
    await DB.db.query(
      `UPDATE voicereport.company_settings
       SET company_name = COALESCE($1, company_name),
           logo_data = COALESCE($2, logo_data),
           logo_filename = COALESCE($3, logo_filename),
           updated_at = NOW()
       WHERE id = 1`,
      [company_name || null, logo_data || null, logo_filename || null]
    );
    const result = await DB.db.query('SELECT * FROM voicereport.company_settings WHERE id = 1');
    res.json(result.rows[0]);
  } catch (e) {
    console.error('Settings PUT error:', e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/settings/logo — remove logo (admin only)
router.delete('/logo', requireAdmin, async (req, res) => {
  try {
    await DB.db.query(
      'UPDATE voicereport.company_settings SET logo_data = NULL, logo_filename = NULL, updated_at = NOW() WHERE id = 1'
    );
    res.json({ message: 'Logo removed' });
  } catch (e) {
    console.error('Settings DELETE logo error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
