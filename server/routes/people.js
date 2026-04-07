const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const DB = require('../../database/db');
const {requireAuth, requireRoleLevel, requireSelfOrRoleLevel, requireSparksEditMode} = require('../middleware/sessionAuth');
const { getActor } = require('../auth/authz');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');

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

// GET all people — auth required, filtered by company_id + role-based visibility
router.get('/', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    let people = await (req.db || DB).people.getAll(req.companyId);
    // Server-side trade filter — if ?trade= is provided, only return people in that trade
    if (req.query.trade) {
      const allTemplates = await DB.templates.getAll();
      const tradeTemplateIds = new Set(allTemplates.filter(t => t.trade === req.query.trade).map(t => t.id));
      people = people.filter(p => tradeTemplateIds.has(p.template_id));
    }
    // Role-based visibility filter (server-side enforcement)
    // Admin/Sparks: see everyone. Foreman+ (level 3+): see supervisor chain via report_visibility.
    // Workers (level 1-2): see self, supervisor, crew (same supervisor), and direct reports only.
    if (!actor.is_admin) {
      if (actor.role_level >= 3) {
        // Foreman+: see everyone in their visibility chain (report_visibility)
        const { rows: visible } = await (req.db || DB).db.query(
          'SELECT person_id FROM report_visibility WHERE viewer_id = $1', [actor.person_id]
        );
        const visibleIds = new Set(visible.map(r => r.person_id));
        // Also include own supervisor chain upward
        visibleIds.add(actor.person_id);
        let supId = (await (req.db || DB).people.getById(actor.person_id))?.supervisor_id;
        let depth = 0;
        while (supId && depth < 10) {
          visibleIds.add(supId);
          const sup = await (req.db || DB).people.getById(supId);
          supId = sup?.supervisor_id;
          depth++;
        }
        people = people.filter(p => visibleIds.has(p.id));
      } else {
        // Workers (level 1-2): self + supervisor + crew (same supervisor) + direct reports
        const visibleIds = new Set([actor.person_id]);
        const me = await (req.db || DB).people.getById(actor.person_id);
        if (me?.supervisor_id) {
          visibleIds.add(me.supervisor_id);
          // Crew mates (same supervisor)
          const { rows: crew } = await (req.db || DB).db.query(
            "SELECT id FROM people WHERE supervisor_id = $1 AND status = 'active'", [me.supervisor_id]
          );
          crew.forEach(c => visibleIds.add(c.id));
        }
        // Direct reports (if any)
        const { rows: reports } = await (req.db || DB).db.query(
          "SELECT id FROM people WHERE supervisor_id = $1 AND status = 'active'", [actor.person_id]
        );
        reports.forEach(r => visibleIds.add(r.id));
        people = people.filter(p => visibleIds.has(p.id));
      }
    }
    res.json(people);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET person by ID — auth required, chain-of-command visibility
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const p = await (req.db || DB).people.getById(req.params.id);
    if (!p) return res.status(404).json({ error: 'Person not found' });
    // Company isolation first
    if (req.companyId && p.company_id && p.company_id !== req.companyId) {
      return res.status(404).json({ error: 'Person not found' });
    }
    const actor = getActor(req);
    if (actor.is_admin) return res.json(p);
    // Self always allowed
    if (actor.person_id === req.params.id) return res.json(p);
    // Chain-of-command: use canViewPerson from authz
    const { canViewPerson } = require('../auth/authz');
    const allowed = await canViewPerson(actor, req.params.id, req.db || DB);
    if (!allowed) return res.status(403).json({ error: 'Not authorized to view this person' });
    res.json(p);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create person — admin/supervisor only, tag with company_id
router.post('/', requireAuth, requireSparksEditMode, requireRoleLevel(3), async (req, res) => {
  try {
    const data = { ...req.body };
    if (req.companyId) data.company_id = req.companyId;
    res.json(await (req.db || DB).people.create(data));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update person — self or supervisor+
// SECURITY: Strip privileged fields for self-edits (prevent self-promotion)
router.put('/:id', requireAuth, requireSparksEditMode, requireSelfOrRoleLevel('id', 3), async (req, res) => {
  try {
    // Company isolation — verify target person is in the same company
    const target = await (req.db || DB).people.getById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Person not found' });
    if (req.companyId && target.company_id && target.company_id !== req.companyId) {
      return res.status(404).json({ error: 'Person not found' });
    }
    // SECURITY: Block self-promotion — strip privileged fields for self-edits
    const isSelfEdit = req.params.id === req.auth.person_id;
    const isAdmin = req.auth.is_admin || req.auth.sparks_role === 'admin';
    if (isSelfEdit && !isAdmin) {
      delete req.body.role_level;
      delete req.body.is_admin;
      delete req.body.sparks_role;
      delete req.body.status;
      delete req.body.company_id;
    }
    const result = await (req.db || DB).people.update(req.params.id, req.body);
    if (!result) return res.status(404).json({ error: 'Person not found' });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete person — admin only, company-scoped
router.delete('/:id', requireAuth, requireSparksEditMode, requireRoleLevel(4), async (req, res) => {
  try {
    // Company isolation — verify target person exists and is in the same company
    const target = await (req.db || DB).people.getById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Person not found' });
    if (req.companyId && target.company_id !== req.companyId) {
      return res.status(404).json({ error: 'Person not found' });
    }
    res.json(await (req.db || DB).people.delete(req.params.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Lead-man — supervisor+
router.put('/:id/lead-man', requireAuth, requireSparksEditMode, requireRoleLevel(3), async (req, res) => {
  try {
    const person = (await (req.db || DB).db.query('SELECT * FROM people WHERE id = $1', [req.params.id])).rows[0];
    if (!person) return res.status(404).json({ error: 'Person not found' });
    if (req.body.is_lead_man) {
      await (req.db || DB).db.query('UPDATE people SET is_lead_man = 0 WHERE supervisor_id = $1 AND id != $2', [person.supervisor_id, req.params.id]);
    }
    await (req.db || DB).db.query('UPDATE people SET is_lead_man = $1 WHERE id = $2', [req.body.is_lead_man ? 1 : 0, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Contact order — self or supervisor+
router.put('/:id/contact-order', requireAuth, requireSparksEditMode, requireSelfOrRoleLevel('id', 3), async (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array' });
    const client = await (req.db || DB).db.connect();
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
    const rows = (await (req.db || DB).db.query('SELECT contact_id, sort_order FROM contact_order WHERE person_id = $1 ORDER BY sort_order', [req.params.id])).rows;
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Photo upload — self or supervisor+
router.post('/:person_id/photo', requireAuth, requireSparksEditMode, requireSelfOrRoleLevel('person_id', 3), photoUpload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo' });
    await (req.db || DB).people.update(req.params.person_id, { photo: req.file.filename });
    res.json({ success: true, photo: req.file.filename });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cert upload — self or supervisor+
router.post('/:person_id/certs', requireAuth, requireSparksEditMode, requireSelfOrRoleLevel('person_id', 3), certUpload.single('cert'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const person = await (req.db || DB).people.getById(req.params.person_id);
    if (!person) return res.status(404).json({ error: 'Person not found' });
    const entry = { filename: req.file.filename, original_name: req.file.originalname, size: req.file.size, type: req.file.mimetype, uploaded_at: new Date().toISOString() };
    await (req.db || DB).db.query('INSERT INTO certifications (person_id, cert_name, file_path, uploaded_at) VALUES ($1, $2, $3, $4)', [req.params.person_id, req.file.originalname, req.file.filename, new Date().toISOString()]);
    res.json({ success: true, file: entry });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cert delete — self or supervisor+
router.delete('/:person_id/certs/:filename', requireAuth, requireSparksEditMode, requireSelfOrRoleLevel('person_id', 3), async (req, res) => {
  try {
    await (req.db || DB).db.query('DELETE FROM certifications WHERE person_id = $1 AND file_path = $2', [req.params.person_id, req.params.filename]);
    const filePath = path.join(__dirname, '../../certs', req.params.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});



// ========== Knowledge Files ==========
const knowledgePath = require('path');
const knowledgeStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = knowledgePath.join(__dirname, '../../knowledge', req.params.person_id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = knowledgePath.extname(file.originalname) || '.txt';
    const base = knowledgePath.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, base + '_' + Date.now() + ext);
  }
});
const knowledgeUpload = multer({ storage: knowledgeStorage, limits: { fileSize: 50 * 1024 * 1024 } });

// GET knowledge files for a person — self or supervisor+
router.get('/:person_id/knowledge', requireAuth, requireSelfOrRoleLevel('person_id', 3), async (req, res) => {
  try {
    const rows = (await (req.db || DB).db.query(
      'SELECT * FROM knowledge_files WHERE person_id = $1 ORDER BY created_at DESC',
      [req.params.person_id]
    )).rows;
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Upload knowledge file
router.post('/:person_id/knowledge', requireAuth, requireSparksEditMode, requireSelfOrRoleLevel('person_id', 3), knowledgeUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });

    let textContent = '';
    const ext = knowledgePath.extname(req.file.originalname).toLowerCase();
    const fullPath = knowledgePath.join(req.file.destination, req.file.filename);

    if (['.txt', '.md', '.csv'].includes(ext)) {
      textContent = fs.readFileSync(fullPath, 'utf8');
    } else if (ext === '.docx' || ext === '.doc') {
      try {
        const result = await mammoth.extractRawText({ path: fullPath });
        textContent = result.value || '';
      } catch (e) { console.error('DOCX extraction failed:', e.message); }
    } else if (ext === '.pdf') {
      try {
        const dataBuffer = fs.readFileSync(fullPath);
        const pdfData = await pdfParse(dataBuffer);
        textContent = pdfData.text || '';
      } catch (e) { console.error('PDF extraction failed:', e.message); }
    }

    const tokenEstimate = Math.ceil(textContent.length / 4);
    const title = req.body.title || req.file.originalname;
    const sourceType = req.body.source_type || 'upload';
    const visibility = req.body.visibility || 'shared';
    const uploadedBy = req.body.uploaded_by || null;

    const result = await (req.db || DB).db.query(
      'INSERT INTO knowledge_files (person_id, uploaded_by, filename, original_name, mime_type, file_path, title, source_type, text_content, token_estimate, visibility) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *',
      [req.params.person_id, uploadedBy, req.file.filename, req.file.originalname,
       req.file.mimetype, req.file.filename, title, sourceType, textContent, tokenEstimate, visibility]
    );

    res.json({ success: true, file: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete knowledge file
router.delete('/:person_id/knowledge/:file_id', requireAuth, requireSparksEditMode, requireSelfOrRoleLevel('person_id', 3), async (req, res) => {
  try {
    const file = (await (req.db || DB).db.query('SELECT * FROM knowledge_files WHERE id = $1 AND person_id = $2', [req.params.file_id, req.params.person_id])).rows[0];
    if (!file) return res.status(404).json({ error: 'File not found' });

    const fullPath = knowledgePath.join(__dirname, '../../knowledge', req.params.person_id, file.filename);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);

    await (req.db || DB).db.query('DELETE FROM knowledge_files WHERE id = $1', [req.params.file_id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Serve knowledge files — self or supervisor+
router.get('/:person_id/knowledge/file/:filename', requireAuth, requireSelfOrRoleLevel('person_id', 3), (req, res) => {
  const fullPath = knowledgePath.join(__dirname, '../../knowledge', req.params.person_id, req.params.filename);
  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File not found' });
  res.sendFile(fullPath);
});

module.exports = router;
