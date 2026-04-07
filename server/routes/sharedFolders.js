const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const DB = require('../../database/db');
const { requireAuth } = require('../middleware/sessionAuth');
const { getActor } = require('../auth/authz');

const router = Router();

// File upload storage for shared folder files
const sharedDir = path.join(__dirname, '../../shared-files');
if (!fs.existsSync(sharedDir)) fs.mkdirSync(sharedDir, { recursive: true });
const storage = multer.diskStorage({
  destination: sharedDir,
  filename: (req, file, cb) => cb(null, `sf_${Date.now()}_${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// Resolve admin sentinel to real person_id
async function resolvePersonId(actor, reqDb) {
  if (actor.person_id !== '__admin__') return actor.person_id;
  const { rows } = await (reqDb || DB).db.query("SELECT id FROM people WHERE sparks_role = 'admin' LIMIT 1");
  return rows[0]?.id || actor.person_id;
}

// GET /folders — list my folders
router.get('/', requireAuth, async (req, res) => {
  try {
    const personId = await resolvePersonId(getActor(req), req.db);
    res.json(await DB.sharedFolders.getForPerson(personId));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /folders — create folder
router.post('/', requireAuth, async (req, res) => {
  try {
    const personId = await resolvePersonId(getActor(req), req.db);
    const { name, description, context_type, context_id, members } = req.body;
    if (!name) return res.status(400).json({ error: 'Folder name required' });
    const folder = await DB.sharedFolders.create({
      name, description, created_by: personId,
      context_type: context_type || 'team', context_id,
    });
    // Add additional members if specified
    if (members && Array.isArray(members)) {
      for (const m of members) {
        if (m.person_id !== personId) {
          await DB.sharedFolders.addMember(folder.id, m.person_id, m.role || 'viewer');
        }
      }
    }
    res.json(folder);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /folders/:id — folder detail with files and members
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const personId = await resolvePersonId(getActor(req), req.db);
    const actor = getActor(req);
    if (!actor.is_admin && !(await DB.sharedFolders.isMember(req.params.id, personId))) {
      return res.status(403).json({ error: 'Not a member of this folder' });
    }
    const folder = await DB.sharedFolders.getById(req.params.id);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });
    const [files, members] = await Promise.all([
      DB.sharedFolders.getFiles(req.params.id),
      DB.sharedFolders.getMembers(req.params.id),
    ]);
    res.json({ ...folder, files, members });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /folders/:id — delete folder (owner only)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    if (!actor.is_admin) {
      const personId = await resolvePersonId(actor, req.db);
      const folder = await DB.sharedFolders.getById(req.params.id);
      if (!folder || folder.created_by !== personId) return res.status(403).json({ error: 'Only the owner can delete' });
    }
    await DB.sharedFolders.deleteFolder(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /folders/:id/members — add member
router.post('/:id/members', requireAuth, async (req, res) => {
  try {
    const { person_id, role } = req.body;
    if (!person_id) return res.status(400).json({ error: 'person_id required' });
    await DB.sharedFolders.addMember(req.params.id, person_id, role || 'viewer');
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /folders/:id/members/:personId — remove member
router.delete('/:id/members/:personId', requireAuth, async (req, res) => {
  try {
    await DB.sharedFolders.removeMember(req.params.id, req.params.personId);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /folders/:id/files — upload file
router.post('/:id/files', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const personId = await resolvePersonId(getActor(req), req.db);
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const file = await DB.sharedFolders.addFile({
      folder_id: req.params.id,
      type: 'file',
      name: req.file.originalname,
      original_name: req.file.originalname,
      filename: req.file.filename,
      mime_type: req.file.mimetype,
      size_bytes: req.file.size,
      uploaded_by: personId,
    });
    res.json(file);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /folders/:id/links — add external link
router.post('/:id/links', requireAuth, async (req, res) => {
  try {
    const personId = await resolvePersonId(getActor(req), req.db);
    const { name, url, description } = req.body;
    if (!name || !url) return res.status(400).json({ error: 'name and url required' });
    const link = await DB.sharedFolders.addFile({
      folder_id: req.params.id,
      type: 'link',
      name,
      url,
      description,
      uploaded_by: personId,
    });
    res.json(link);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /folders/files/:fileId — remove file/link
router.delete('/files/:fileId', requireAuth, async (req, res) => {
  try {
    await DB.sharedFolders.removeFile(req.params.fileId);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Serve shared files
router.get('/download/:filename', requireAuth, (req, res) => {
  const filePath = path.join(sharedDir, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.sendFile(filePath);
});

module.exports = router;
