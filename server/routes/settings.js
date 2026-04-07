const { Router } = require('express');
const DB = require('../../database/db');
const { requireAuth, requireAdmin } = require('../middleware/sessionAuth');

const router = Router();

// GET /api/settings — fetch company settings (public — needed for login screen logo)
// Uses req.companyId for multi-tenant, falls back to id=1 for generic/login
router.get('/', async (req, res) => {
  try {
    let result;
    if (req.companyId) {
      result = await DB.db.query('SELECT * FROM voicereport.company_settings WHERE company_id = $1', [req.companyId]);
    }
    if (!result || result.rows.length === 0) {
      result = await DB.db.query('SELECT * FROM voicereport.company_settings WHERE id = 1');
    }
    res.json(result.rows[0] || { id: 1, company_name: 'Horizon Sparks', logo_data: null });
  } catch (e) {
    console.error('Settings GET error:', e);
    res.json({ id: 1, company_name: 'Horizon Sparks', logo_data: null });
  }
});

// PUT /api/settings — update company name and/or logo (admin only)
// Updates per-company settings if companyId exists, otherwise updates global (id=1)
router.put('/', requireAdmin, async (req, res) => {
  try {
    const { company_name, logo_data, logo_filename } = req.body;
    if (req.companyId) {
      // Upsert per-company settings
      const existing = await DB.db.query('SELECT id FROM voicereport.company_settings WHERE company_id = $1', [req.companyId]);
      if (existing.rows.length > 0) {
        await DB.db.query(
          `UPDATE voicereport.company_settings
           SET company_name = COALESCE($1, company_name),
               logo_data = COALESCE($2, logo_data),
               logo_filename = COALESCE($3, logo_filename),
               updated_at = NOW()
           WHERE company_id = $4`,
          [company_name || null, logo_data || null, logo_filename || null, req.companyId]
        );
      } else {
        await DB.db.query(
          `INSERT INTO voicereport.company_settings (company_id, company_name, logo_data, logo_filename, updated_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [req.companyId, company_name || 'Company', logo_data || null, logo_filename || null]
        );
      }
      const result = await DB.db.query('SELECT * FROM voicereport.company_settings WHERE company_id = $1', [req.companyId]);
      res.json(result.rows[0]);
    } else {
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
    }
  } catch (e) {
    console.error('Settings PUT error:', e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/settings/role-levels — toggle active role levels per trade (admin only)
// Body: { trade: "Pipe Fitting", levels: [1, 2, 4, 5] }
// Empty levels array or missing trade = all levels active (default)
router.put('/role-levels', requireAdmin, async (req, res) => {
  try {
    const { trade, levels } = req.body;
    if (!trade) return res.status(400).json({ error: 'trade is required' });
    // Load current config — prefer per-company, fallback to global
    const whereClause = req.companyId ? 'company_id = $1' : 'id = 1';
    const whereParams = req.companyId ? [req.companyId] : [];
    const current = await DB.db.query(`SELECT active_role_levels FROM voicereport.company_settings WHERE ${whereClause}`, whereParams);
    const config = current.rows[0]?.active_role_levels || {};
    // Update this trade's levels
    if (!levels || levels.length === 0) {
      delete config[trade];
    } else {
      config[trade] = levels;
    }
    await DB.db.query(
      `UPDATE voicereport.company_settings SET active_role_levels = $1, updated_at = NOW() WHERE ${whereClause}`,
      [JSON.stringify(config), ...whereParams]
    );
    res.json({ active_role_levels: config });
  } catch (e) {
    console.error('Settings role-levels PUT error:', e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/settings/logo — remove logo (admin only)
router.delete('/logo', requireAdmin, async (req, res) => {
  try {
    const whereClause = req.companyId ? 'company_id = $1' : 'id = 1';
    const whereParams = req.companyId ? [req.companyId] : [];
    await DB.db.query(
      `UPDATE voicereport.company_settings SET logo_data = NULL, logo_filename = NULL, updated_at = NOW() WHERE ${whereClause}`,
      whereParams
    );
    res.json({ message: 'Logo removed' });
  } catch (e) {
    console.error('Settings DELETE logo error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
