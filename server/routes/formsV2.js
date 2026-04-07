const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const DB = require('../../database/db');
const {requireAuth, requireAdmin, requireSparksEditMode} = require('../middleware/sessionAuth');
const { getActor } = require('../auth/authz');
const { serializeFieldValue, deserializeValues } = require('../services/forms/fieldSerializer');
const { insertForm } = require('../services/forms/seedHelpers');

const router = Router();

// Form templates
router.get('/templates', requireAuth, async (req, res) => {
  try {
    const templates = (await DB.db.query('SELECT * FROM form_templates_v2 ORDER BY trade, form_code')).rows;
    res.json(templates);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/templates/:id', requireAuth, async (req, res) => {
  try {
    const template = (await DB.db.query('SELECT * FROM form_templates_v2 WHERE id = $1', [req.params.id])).rows[0];
    if (!template) return res.status(404).json({ error: 'Form template not found' });
    const fields = (await DB.db.query('SELECT * FROM form_fields_v2 WHERE template_id = $1 ORDER BY display_order', [req.params.id])).rows;
    res.json({ ...template, fields });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Loops
router.get('/loops', requireAuth, async (req, res) => {
  try {
    const loops = (await (req.db || DB).db.query('SELECT * FROM form_loops ORDER BY tag_number')).rows;
    res.json(loops);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/loops/:id', requireAuth, async (req, res) => {
  try {
    const loop = (await (req.db || DB).db.query('SELECT * FROM form_loops WHERE id = $1', [req.params.id])).rows[0];
    if (!loop) return res.status(404).json({ error: 'Loop not found' });
    res.json(loop);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Submissions — filtered by company via person's company_id
router.get('/submissions', requireAuth, async (req, res) => {
  try {
    let query, params = [];
    if (req.companyId) {
      query = `SELECT s.*, ft.form_code, ft.form_title
         FROM form_submissions s
         JOIN form_templates_v2 ft ON ft.id = s.template_id
         LEFT JOIN people p ON p.id = s.person_id
         WHERE p.company_id = $1
         ORDER BY s.created_at DESC`;
      params = [req.companyId];
    } else {
      query = `SELECT s.*, ft.form_code, ft.form_title
         FROM form_submissions s
         JOIN form_templates_v2 ft ON ft.id = s.template_id
         ORDER BY s.created_at DESC`;
    }
    const subs = (await (req.db || DB).db.query(query, params)).rows;
    res.json(subs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/submissions/:id', requireAuth, async (req, res) => {
  try {
    let subQuery, subParams;
    if (req.companyId) {
      subQuery = `SELECT s.*, ft.form_code, ft.form_title, ft.id as tid
       FROM form_submissions s
       JOIN form_templates_v2 ft ON ft.id = s.template_id
       LEFT JOIN people p ON p.id = s.person_id
       WHERE s.id = $1 AND p.company_id = $2`;
      subParams = [req.params.id, req.companyId];
    } else {
      subQuery = `SELECT s.*, ft.form_code, ft.form_title, ft.id as tid
       FROM form_submissions s
       JOIN form_templates_v2 ft ON ft.id = s.template_id
       WHERE s.id = $1`;
      subParams = [req.params.id];
    }
    const sub = (await (req.db || DB).db.query(subQuery, subParams)).rows[0];
    if (!sub) return res.status(404).json({ error: 'Submission not found' });

    const values = (await (req.db || DB).db.query('SELECT * FROM form_submission_values WHERE submission_id = $1', [req.params.id])).rows;
    const calPoints = (await (req.db || DB).db.query('SELECT * FROM form_calibration_points WHERE submission_id = $1 ORDER BY percent_range', [req.params.id])).rows;
    const fields = (await DB.db.query('SELECT * FROM form_fields_v2 WHERE template_id = $1 ORDER BY display_order', [sub.tid])).rows;

    const valuesMap = deserializeValues(values);

    res.json({ ...sub, values: valuesMap, calibration_points: calPoints, fields });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/submissions', requireAuth, requireSparksEditMode, async (req, res) => {
  const client = await (req.db || DB).db.connect();
  try {
    const { template_id, loop_id, technician_name, values, calibration_points } = req.body;
    const person_id = req.auth.person_id;
    const template = (await client.query('SELECT * FROM form_templates_v2 WHERE id = $1', [template_id])).rows[0];
    if (!template) { client.release(); return res.status(400).json({ error: 'Template not found' }); }

    const id = uuidv4();
    const now = new Date().toISOString();

    await client.query('BEGIN');

    await client.query(
      `INSERT INTO form_submissions (id, template_id, loop_id, tag_number, person_id, status, technician_name, started_at, submitted_at)
       VALUES ($1, $2, $3, $4, $5, 'submitted', $6, $7, $8)`,
      [id, template_id, loop_id || null, values?.tag_number || null, person_id || null, technician_name, now, now]
    );

    if (values) {
      for (const [key, val] of Object.entries(values)) {
        const serialized = serializeFieldValue(key, val);
        if (!serialized) continue;
        await client.query(
          'INSERT INTO form_submission_values (submission_id, field_name, text_value, numeric_value, boolean_value, json_value) VALUES ($1, $2, $3, $4, $5, $6)',
          [id, serialized.field_name, serialized.text_value, serialized.numeric_value, serialized.boolean_value, serialized.json_value]
        );
      }
    }

    if (calibration_points) {
      for (const cp of calibration_points) {
        await client.query(
          'INSERT INTO form_calibration_points (submission_id, percent_range, input_value, input_unit, as_found_output, calibrated_output, dcs_reading, output_unit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [id, cp.percent_range, cp.input_value || null, cp.input_unit || 'mA', cp.as_found_output || null, cp.calibrated_output || null, cp.dcs_reading || null, cp.output_unit || 'mA']
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ id, status: 'submitted' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Reseed endpoint — wipe and reseed all 27 templates
router.post("/reseed", requireAdmin, requireSparksEditMode, async (req, res) => {
  try {
    await DB.db.query('DELETE FROM form_fields_v2');
    await DB.db.query('DELETE FROM form_templates_v2');
    // Fall through to seed logic below via redirect
    res.redirect(307, '/api/forms/seed');
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Seed endpoint — loads form templates from JSON config
router.post("/seed", requireAdmin, requireSparksEditMode, async (req, res) => {
  const client = await DB.db.connect();
  try {
    const formDefs = require('../config/form-templates.json');
    const existing = (await client.query('SELECT COUNT(*) as cnt FROM form_templates_v2')).rows[0];
    if (existing.cnt >= formDefs.length) { client.release(); return res.json({ message: 'Already seeded', count: existing.cnt }); }
    if (existing.cnt > 0 && existing.cnt < formDefs.length) {
      await client.query('DELETE FROM form_fields_v2');
      await client.query('DELETE FROM form_templates_v2');
    }

    await client.query('BEGIN');

    // Insert all forms from JSON config
    for (const formDef of formDefs) {
      const fields = formDef.fields.map(f => [
        f.field_name, f.field_label, f.field_type, f.field_group,
        f.display_order, f.is_required, f.unit, f.select_options, f.default_value,
      ]);
      await insertForm(client, formDef.code, formDef.title, formDef.category, formDef.trade, fields, formDef.type);
    }

    await client.query('COMMIT');

    const count = (await client.query('SELECT COUNT(*) as cnt FROM form_templates_v2')).rows[0];
    res.json({ message: `Seeded ${formDefs.length} form templates`, count: count.cnt });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
