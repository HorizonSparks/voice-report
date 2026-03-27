const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const DB = require('../../database/db');
const { requireAuth, requireRoleLevel, requireSelfOrRoleLevel } = require('../middleware/sessionAuth');
const { getActor } = require('../auth/authz');

const router = Router();

// Photo upload
const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../photos');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = file.originalname.split('.').pop() || 'jpg';
    cb(null, `${req.params.person_id}.${ext}`);
  }
});
const photoUpload = multer({ storage: photoStorage, limits: { fileSize: 10 * 1024 * 1024 } });

// Cert upload
const certStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../certs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${req.params.person_id}_${base}_${Date.now()}${ext}`);
  }
});
const certUpload = multer({ storage: certStorage, limits: { fileSize: 20 * 1024 * 1024 } });

// GET all people — auth required
router.get('/', requireAuth, async (req, res) => {
  try { res.json(await DB.people.getAll()); } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET person by ID — auth required, self or supervisor+
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const p = await DB.people.getById(req.params.id);
    if (!p) return res.status(404).json({ error: 'Person not found' });
    res.json(p);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create person — admin/supervisor only
router.post('/', requireAuth, requireRoleLevel(3), async (req, res) => {
  try { res.json(await DB.people.create(req.body)); } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update person — self or supervisor+
router.put('/:id', requireAuth, requireSelfOrRoleLevel('id', 3), async (req, res) => {
  try {
    const result = await DB.people.update(req.params.id, req.body);
    if (!result) return res.status(404).json({ error: 'Person not found' });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete person — admin only
router.delete('/:id', requireAuth, requireRoleLevel(4), async (req, res) => {
  try { res.json(await DB.people.delete(req.params.id)); } catch (err) { res.status(500).json({ error: err.message }); }
});

// Lead-man — supervisor+
router.put('/:id/lead-man', requireAuth, requireRoleLevel(3), async (req, res) => {
  try {
    const person = (await DB.db.query('SELECT * FROM people WHERE id = $1', [req.params.id])).rows[0];
    if (!person) return res.status(404).json({ error: 'Person not found' });
    if (req.body.is_lead_man) {
      await DB.db.query('UPDATE people SET is_lead_man = 0 WHERE supervisor_id = $1 AND id != $2', [person.supervisor_id, req.params.id]);
    }
    await DB.db.query('UPDATE people SET is_lead_man = $1 WHERE id = $2', [req.body.is_lead_man ? 1 : 0, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Contact order — self or supervisor+
router.put('/:id/contact-order', requireAuth, requireSelfOrRoleLevel('id', 3), async (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array' });
    const client = await DB.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM contact_order WHERE person_id = $1', [req.params.id]);
      for (let i = 0; i < order.length; i++) {
        await client.query('INSERT INTO contact_order (person_id, contact_id, sort_order) VALUES ($1, $2, $3)', [req.params.id, order[i], i]);
      }
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/contact-order', requireAuth, async (req, res) => {
  try {
    const rows = (await DB.db.query('SELECT contact_id, sort_order FROM contact_order WHERE person_id = $1 ORDER BY sort_order', [req.params.id])).rows;
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Photo upload — self or supervisor+
router.post('/:person_id/photo', requireAuth, requireSelfOrRoleLevel('person_id', 3), photoUpload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo' });
    await DB.people.update(req.params.person_id, { photo: req.file.filename });
    res.json({ success: true, photo: req.file.filename });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cert upload — self or supervisor+
router.post('/:person_id/certs', requireAuth, requireSelfOrRoleLevel('person_id', 3), certUpload.single('cert'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const person = await DB.people.getById(req.params.person_id);
    if (!person) return res.status(404).json({ error: 'Person not found' });
    const entry = { filename: req.file.filename, original_name: req.file.originalname, size: req.file.size, type: req.file.mimetype, uploaded_at: new Date().toISOString() };
    await DB.db.query('INSERT INTO certifications (person_id, cert_name, file_path, uploaded_at) VALUES ($1, $2, $3, $4)', [req.params.person_id, req.file.originalname, req.file.filename, new Date().toISOString()]);
    res.json({ success: true, file: entry });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cert delete — self or supervisor+
router.delete('/:person_id/certs/:filename', requireAuth, requireSelfOrRoleLevel('person_id', 3), async (req, res) => {
  try {
    await DB.db.query('DELETE FROM certifications WHERE person_id = $1 AND file_path = $2', [req.params.person_id, req.params.filename]);
    const filePath = path.join(__dirname, '../../certs', req.params.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
