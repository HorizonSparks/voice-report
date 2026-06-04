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

// ---- P1.3 access control ----
// NOTE: shared_folders/_members/_files live on the SHARED pool (DB.withPool leaves
// DB.sharedFolders on the shared DB), so these checks query DB.db / DB.sharedFolders
// directly — NOT req.db — to stay correct when per-company DBs are enabled.
//
// A folder is accessible to the actor if they are admin, the owner, an explicit member,
// or it is a company folder for their own company. Closes the "operate on any folder by
// id" cross-tenant hole on the member/file/link/download routes.
async function canAccessFolder(folderId, actor, personId, companyId) {
  if (!folderId) return false;
  if (actor.is_sparks) return true; // cross-tenant bypass is Sparks-staff-only (not role>=5)
  if (!personId) return false;
  const { rows } = await DB.db.query(
    `SELECT 1 FROM shared_folders f
     WHERE f.id = $1 AND (
       f.created_by = $2
       OR (f.context_type = 'company' AND f.context_id = $3)
       OR EXISTS (SELECT 1 FROM shared_folder_members m WHERE m.folder_id = f.id AND m.person_id = $2)
     ) LIMIT 1`,
    [folderId, personId, companyId || null]
  );
  return rows.length > 0;
}

// Managing membership / destructive folder ops require owner or admin.
async function isFolderOwnerOrAdmin(folderId, actor, personId) {
  if (actor.is_sparks) return true; // cross-tenant bypass is Sparks-staff-only (not role>=5)
  if (!folderId || !personId) return false;
  const folder = await DB.sharedFolders.getById(folderId);
  return !!folder && folder.created_by === personId;
}

// Non-admins may only add members from their OWN company (people live on the company pool).
async function memberInActorCompany(memberPersonId, companyId, reqDb) {
  if (!memberPersonId || !companyId) return false;
  const { rows } = await (reqDb || DB).db.query(
    'SELECT 1 FROM people WHERE id = $1 AND company_id = $2 LIMIT 1', [memberPersonId, companyId]
  );
  return rows.length > 0;
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
    const actor = getActor(req);
    const personId = await resolvePersonId(actor, req.db);
    const { name, description, context_type, members } = req.body;
    let { context_id } = req.body;
    if (!name) return res.status(400).json({ error: 'Folder name required' });
    const ctype = context_type || 'team';
    // Non-admins cannot create a company folder pointed at another tenant.
    if (!actor.is_sparks && ctype === 'company') context_id = req.companyId;
    const folder = await DB.sharedFolders.create({
      name, description, created_by: personId,
      context_type: ctype, context_id,
    });
    // Add additional members — non-admins may only add people in their own company.
    if (members && Array.isArray(members)) {
      for (const m of members) {
        if (m.person_id === personId) continue;
        if (!actor.is_sparks && !(await memberInActorCompany(m.person_id, req.companyId, req.db))) continue;
        await DB.sharedFolders.addMember(folder.id, m.person_id, m.role || 'viewer');
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
    if (!actor.is_sparks && !(await DB.sharedFolders.isMember(req.params.id, personId))) {
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

// PUT /folders/:id — rename folder (owner or admin)
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Folder name required' });
    const actor = getActor(req);
    if (!actor.is_sparks) {
      const personId = await resolvePersonId(actor, req.db);
      const folder = await DB.sharedFolders.getById(req.params.id);
      if (!folder || folder.created_by !== personId) return res.status(403).json({ error: 'Only the owner can rename' });
    }
    await DB.db.query('UPDATE shared_folders SET name = $1, updated_at = NOW() WHERE id = $2', [name.trim(), req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /folders/:id — delete folder (owner only)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    if (!actor.is_sparks) {
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
    const actor = getActor(req);
    const personId = await resolvePersonId(actor, req.db);
    if (!(await isFolderOwnerOrAdmin(req.params.id, actor, personId))) {
      return res.status(403).json({ error: 'Only the folder owner can manage members' });
    }
    if (!actor.is_sparks && !(await memberInActorCompany(person_id, req.companyId, req.db))) {
      return res.status(403).json({ error: 'Can only add members from your own company' });
    }
    await DB.sharedFolders.addMember(req.params.id, person_id, role || 'viewer');
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /folders/:id/members/:personId — remove member
router.delete('/:id/members/:personId', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    const personId = await resolvePersonId(actor, req.db);
    if (!(await isFolderOwnerOrAdmin(req.params.id, actor, personId))) {
      return res.status(403).json({ error: 'Only the folder owner can manage members' });
    }
    await DB.sharedFolders.removeMember(req.params.id, req.params.personId);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /folders/:id/files — upload file
router.post('/:id/files', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const actor = getActor(req);
    const personId = await resolvePersonId(actor, req.db);
    if (!(await canAccessFolder(req.params.id, actor, personId, req.companyId))) {
      if (req.file) fs.unlink(req.file.path, () => {}); // don't leave an orphaned upload
      return res.status(403).json({ error: 'Not authorized for this folder' });
    }
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
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {}); // clean up if persistence failed
    res.status(500).json({ error: err.message });
  }
});

// POST /folders/:id/links — add external link
router.post('/:id/links', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    const personId = await resolvePersonId(actor, req.db);
    if (!(await canAccessFolder(req.params.id, actor, personId, req.companyId))) {
      return res.status(403).json({ error: 'Not authorized for this folder' });
    }
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

// DELETE /folders/files/:fileId — remove file/link (uploader, folder owner, or admin)
router.delete('/files/:fileId', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    const personId = await resolvePersonId(actor, req.db);
    const { rows } = await DB.db.query(
      'SELECT folder_id, uploaded_by FROM shared_files WHERE id = $1', [req.params.fileId]
    );
    const fileRow = rows[0];
    if (!fileRow) return res.status(404).json({ error: 'File not found' });
    // Must CURRENTLY have folder access, AND be the uploader, owner, or admin — so a
    // removed/transferred uploader can no longer delete by file id.
    if (!(await canAccessFolder(fileRow.folder_id, actor, personId, req.companyId))) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const ownerOrAdmin = await isFolderOwnerOrAdmin(fileRow.folder_id, actor, personId);
    if (!ownerOrAdmin && fileRow.uploaded_by !== personId) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    await DB.sharedFolders.removeFile(req.params.fileId);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Serve shared files — only to someone who can access the file's folder.
router.get('/download/:filename', requireAuth, async (req, res) => {
  try {
    const filename = req.params.filename;
    // Path-traversal defense: a single path segment only.
    if (path.basename(filename) !== filename) return res.status(404).json({ error: 'File not found' });
    const actor = getActor(req);
    const personId = await resolvePersonId(actor, req.db);
    const { rows } = await DB.db.query(
      'SELECT folder_id FROM shared_files WHERE filename = $1', [filename]
    );
    const fileRow = rows[0];
    if (!fileRow) return res.status(404).json({ error: 'File not found' });
    if (!(await canAccessFolder(fileRow.folder_id, actor, personId, req.companyId))) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const filePath = path.join(sharedDir, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    res.sendFile(filePath);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
