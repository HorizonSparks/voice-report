const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const { requireAuth, requireAdmin } = require('../middleware/sessionAuth');

const router = Router();

function readJsonDir(dirName) {
  const dirPath = path.join(__dirname, '../..', dirName);
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(dirPath, f), 'utf-8')));
}

function readJson(dirName, id) {
  const filePath = path.join(__dirname, '../..', dirName, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeJson(dirName, id, data) {
  const dirPath = path.join(__dirname, '../..', dirName);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(path.join(dirPath, `${id}.json`), JSON.stringify(data, null, 2));
}

// Legacy form submission — auth required
router.post('/', requireAuth, (req, res) => {
  try {
    const form = req.body;
    const id = `form_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    form.id = id;
    if (!form.created_at) form.created_at = new Date().toISOString();
    writeJson('forms', id, form);
    res.json({ success: true, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Legacy form listing — auth required
router.get('/', requireAuth, (req, res) => {
  try {
    let forms = readJsonDir('forms').map(f => ({
      id: f.id, person_id: f.person_id, person_name: f.person_name,
      form_type: f.form_type, form_title: f.form_title, created_at: f.created_at,
    }));
    if (req.query.person_id) forms = forms.filter(f => f.person_id === req.query.person_id);
    if (req.companyId) forms = forms.filter(f => f.company_id === req.companyId);
    forms.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(forms);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', requireAuth, (req, res) => {
  const f = readJson('forms', req.params.id);
  if (!f) return res.status(404).json({ error: 'Form not found' });
  res.json(f);
});

// Safety basics — read requires auth, write requires admin
router.get('/safety-basics', requireAuth, (req, res) => {
  try {
    const filePath = path.join(__dirname, '../../safety_basics.json');
    if (!fs.existsSync(filePath)) return res.json({ safety_rules: [], safety_vocabulary: [], tools_and_equipment: [] });
    res.json(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/safety-basics', requireAdmin, (req, res) => {
  try {
    const data = { ...req.body, updated_at: new Date().toISOString() };
    fs.writeFileSync(path.join(__dirname, '../../safety_basics.json'), JSON.stringify(data, null, 2));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
