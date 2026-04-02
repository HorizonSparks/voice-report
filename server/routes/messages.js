const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const DB = require('../../database/db');
const {requireAuth, requireRoleLevel, requireSparksEditMode} = require('../middleware/sessionAuth');
const { getActor, canMessage } = require('../auth/authz');

const router = Router();

// Resolve __admin__ sentinel to real person_id for Sparks team messaging
async function resolveAdminId(actorPersonId, bodyFromId, reqDb) {
  if (actorPersonId !== '__admin__' || !bodyFromId) return actorPersonId;
  const { rows } = await (reqDb || DB).db.query("SELECT id FROM people WHERE id = $1 AND sparks_role = 'admin'", [bodyFromId]);
  return rows.length > 0 ? rows[0].id : actorPersonId;
}

// Legacy messages — require auth, derive person from session
router.get('/messages/:person_id', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    // Can only read own legacy messages unless admin/supervisor
    if (actor.person_id !== req.params.person_id && !actor.is_admin && actor.role_level < 3) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    res.json(await (req.db || DB).legacyMessages.getForPerson(req.params.person_id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/messages/:person_id', requireAuth, requireSparksEditMode, async (req, res) => {
  try {
    const actor = getActor(req);
    // Only admin/supervisors can send legacy messages
    if (!actor.is_admin && actor.role_level < 3) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    let msgs = await (req.db || DB).legacyMessages.getForPerson(req.params.person_id);
    const msg = {
      id: 'msg_' + Date.now(),
      from: actor.is_admin ? 'Admin' : (await (req.db || DB).people.getById(actor.person_id))?.name || 'Unknown',
      from_role: req.body.from_role || 'Supervisor',
      text: req.body.text,
      created_at: new Date().toISOString(), addressed_in_report: null,
    };
    msgs.push(msg);
    await (req.db || DB).legacyMessages.save(req.params.person_id, msgs);
    res.json({ success: true, message: msg });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/messages/:person_id/mark-addressed', requireAuth, requireSparksEditMode, async (req, res) => {
  try {
    const actor = getActor(req);
    // Only the recipient (person_id), the sender, or supervisor+ can mark messages addressed
    if (actor.person_id !== req.params.person_id && !actor.is_admin && actor.role_level < 3) {
      return res.status(403).json({ error: 'Not authorized to mark these messages' });
    }
    let msgs = await (req.db || DB).legacyMessages.getForPerson(req.params.person_id);
    const { message_ids, report_id } = req.body;
    msgs = msgs.map(m => message_ids.includes(m.id) ? { ...m, addressed_in_report: report_id } : m);
    await (req.db || DB).legacyMessages.save(req.params.person_id, msgs);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// V2 messaging — all require auth, derive actor from session
router.get('/v2/contacts/:person_id', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    // Use actor's own person_id for contacts (ignore URL param for self, allow admin override)
    const targetId = actor.is_admin ? req.params.person_id : actor.person_id;
    res.json(await (req.db || DB).contacts.getForPerson(targetId));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/v2/conversations/:person_id', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    const targetId = actor.is_admin ? req.params.person_id : actor.person_id;
    res.json(await (req.db || DB).contacts.getConversationList(targetId));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/v2/messages/:person_id/:contact_id', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    // Actor must be one of the parties in the conversation (or admin)
    if (!actor.is_admin && actor.person_id !== req.params.person_id) {
      return res.status(403).json({ error: 'Not authorized to view this conversation' });
    }
    if (!(await (req.db || DB).contacts.canMessage(req.params.person_id, req.params.contact_id))) {
      return res.status(403).json({ error: 'Not authorized to view this conversation' });
    }
    const msgs = await (req.db || DB).messages.getConversation(req.params.person_id, req.params.contact_id);
    await (req.db || DB).db.query('UPDATE messages SET read_at = $1 WHERE to_id = $2 AND from_id = $3 AND read_at IS NULL',
      [new Date().toISOString(), req.params.person_id, req.params.contact_id]);
    res.json(msgs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /v2/messages — DERIVE from_id from session, accept to_id from body
router.post('/v2/messages', requireAuth, requireSparksEditMode, async (req, res) => {
  try {
    const actor = getActor(req);
    const { to_id, content, type } = req.body;
    // DERIVE actor — ignore client-sent from_id (resolve __admin__ sentinel for team chat)
    const from_id = await resolveAdminId(actor.person_id, req.body.from_id, req.db);

    if (!from_id || !to_id || !content) return res.status(400).json({ error: 'to_id and content required' });

    // No bypass for safety_alert — always check authorization
    if (!(await canMessage(actor, to_id, req.db))) {
      return res.status(403).json({ error: 'Not authorized to message this person.' });
    }
    const fromPerson = from_id ? (await (req.db || DB).db.query('SELECT name FROM people WHERE id = $1', [from_id])).rows[0] : null;
    const toPerson = (await (req.db || DB).db.query('SELECT name FROM people WHERE id = $1', [to_id])).rows[0];
    res.json(await (req.db || DB).messages.create({
      from_id, to_id, from_name: fromPerson?.name || (actor.is_admin ? 'Admin' : ''), to_name: toPerson?.name || '',
      content, type: type || 'text', audio_file: req.body.audio_file || null,
      photo: req.body.photo || null, metadata: req.body.metadata || {},
    }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Group messages — require supervisor role, derive from_id from session
router.post('/v2/messages/group', requireAuth, requireSparksEditMode, requireRoleLevel(2), async (req, res) => {
  try {
    const actor = getActor(req);
    const from_id = await resolveAdminId(actor.person_id, req.body.from_id, req.db);
    const { content, type } = req.body;
    if (!content) return res.status(400).json({ error: 'content required' });
    const fromPerson = (await (req.db || DB).db.query('SELECT name, role_level FROM people WHERE id = $1', [from_id])).rows[0];
    const team = await (req.db || DB).people.getTeam(from_id);
    const results = [];
    for (const member of team) {
      results.push(await (req.db || DB).messages.create({
        from_id, to_id: member.id, from_name: fromPerson?.name || '', to_name: member.name,
        content, type: type || 'text', metadata: { group: true },
      }));
    }
    res.json({ success: true, sent_to: team.length, results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Photo messages — derive from_id from session
const msgPhotoDir = path.join(__dirname, '../../message-photos');
if (!fs.existsSync(msgPhotoDir)) fs.mkdirSync(msgPhotoDir, { recursive: true });
const msgPhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, msgPhotoDir),
  filename: (req, file, cb) => cb(null, `msg_${Date.now()}_${file.originalname}`),
});
const msgPhotoUpload = multer({ storage: msgPhotoStorage, limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/v2/messages/photo', requireAuth, requireSparksEditMode, msgPhotoUpload.single('photo'), async (req, res) => {
  try {
    const actor = getActor(req);
    const from_id = await resolveAdminId(actor.person_id, req.body.from_id, req.db);
    const { to_id } = req.body;
    if (!from_id || !to_id || !req.file) return res.status(400).json({ error: 'to_id and photo required' });
    if (!(await canMessage(actor, to_id, req.db))) return res.status(403).json({ error: "Not authorized to message this person" });
    const fromPerson = (await (req.db || DB).db.query('SELECT name FROM people WHERE id = $1', [from_id])).rows[0];
    const toPerson = (await (req.db || DB).db.query('SELECT name FROM people WHERE id = $1', [to_id])).rows[0];
    res.json(await (req.db || DB).messages.create({
      from_id, to_id, from_name: fromPerson?.name || '', to_name: toPerson?.name || '',
      content: 'Photo', type: 'photo', photo: req.file.filename, metadata: {},
    }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Voice messages — derive from_id from session
const msgAudioDir = path.join(__dirname, '../../message-audio');
if (!fs.existsSync(msgAudioDir)) fs.mkdirSync(msgAudioDir, { recursive: true });
// File attachments
const msgFileDir = path.join(__dirname, '../../message-files');
if (!fs.existsSync(msgFileDir)) fs.mkdirSync(msgFileDir, { recursive: true });
const msgFileStorage = multer.diskStorage({
  destination: msgFileDir,
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, 'msg_' + Date.now() + '_' + safeName);
  }
});
const msgFileUpload = multer({ storage: msgFileStorage, limits: { fileSize: 50 * 1024 * 1024 } });

const msgAudioStorage = multer.diskStorage({
  destination: msgAudioDir,
  filename: (req, file, cb) => { const ext = file.originalname.split('.').pop() || 'webm'; cb(null, `msg_${Date.now()}_audio.${ext}`); }
});
const msgAudioUpload = multer({ storage: msgAudioStorage, limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/v2/messages/voice', requireAuth, requireSparksEditMode, msgAudioUpload.single('audio'), async (req, res) => {
  try {
    const actor = getActor(req);
    const from_id = await resolveAdminId(actor.person_id, req.body.from_id, req.db);
    const { to_id } = req.body;
    if (!from_id || !to_id || !req.file) return res.status(400).json({ error: 'to_id and audio required' });
    if (!(await canMessage(actor, to_id, req.db))) return res.status(403).json({ error: "Not authorized to message this person" });
    let transcript = '';
    try {
      const audioBuffer = fs.readFileSync(req.file.path);
      const ext = req.file.originalname.split('.').pop() || 'webm';
      const mimeMap = { m4a: 'audio/mp4', webm: 'audio/webm', ogg: 'audio/ogg' };
      const blob = new Blob([audioBuffer], { type: mimeMap[ext] || 'audio/webm' });
      const form = new FormData();
      form.append('file', blob, `voice_msg.${ext}`);
      form.append('model', 'whisper-1');
      form.append('response_format', 'json');
      const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST', headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }, body: form,
      });
      if (whisperRes.ok) { const data = await whisperRes.json(); transcript = data.text || ''; }
    } catch (e) { console.error('Voice msg transcription error:', e); }
    const fromPerson = (await (req.db || DB).db.query('SELECT name FROM people WHERE id = $1', [from_id])).rows[0];
    const toPerson = (await (req.db || DB).db.query('SELECT name FROM people WHERE id = $1', [to_id])).rows[0];
    res.json(await (req.db || DB).messages.create({
      from_id, to_id, from_name: fromPerson?.name || '', to_name: toPerson?.name || '',
      content: 'Voice message', type: 'voice', audio_file: req.file.filename, metadata: { transcript },
    }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Unread count — derive person from session
router.get('/v2/unread/:person_id', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    const targetId = actor.is_admin ? req.params.person_id : actor.person_id;
    res.json({ count: (await (req.db || DB).messages.getUnread(targetId)).length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// Delete a message (sender or admin/supervisor can delete)
router.delete('/v2/messages/:message_id', requireAuth, requireSparksEditMode, async (req, res) => {
  try {
    const actor = getActor(req);
    const message = (await (req.db || DB).db.query('SELECT * FROM messages WHERE id = $1', [req.params.message_id])).rows[0];
    if (!message) return res.status(404).json({ error: 'Message not found' });

    // Only sender, admin, or supervisor can delete
    if (message.from_id !== actor.person_id && !actor.is_admin && actor.role_level < 3) {
      return res.status(403).json({ error: 'Not authorized to delete this message' });
    }

    // Delete attached files if any
    if (message.audio_file) {
      const audioPath = path.join(__dirname, '../../message-audio', message.audio_file);
      if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    }
    if (message.photo) {
      const photoPath = path.join(__dirname, '../../message-photos', message.photo);
      if (fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
    }

    await (req.db || DB).db.query('DELETE FROM messages WHERE id = $1', [req.params.message_id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// Send file attachment message — DERIVE from_id from session
router.post('/v2/messages/file', requireAuth, requireSparksEditMode, msgFileUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const actor = getActor(req);
    const from_id = await resolveAdminId(actor.person_id, req.body.from_id, req.db);
    const { to_id } = req.body;
    if (!from_id || !to_id) return res.status(400).json({ error: 'to_id required' });
    if (!(await canMessage(actor, to_id, req.db))) return res.status(403).json({ error: "Not authorized to message this person" });

    const fromPerson = await (req.db || DB).people.getById(from_id);
    const toPerson = await (req.db || DB).people.getById(to_id);
    const id = 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    await (req.db || DB).db.query(
      "INSERT INTO messages (id, from_id, to_id, from_name, to_name, type, content, metadata, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [id, from_id, to_id,
       fromPerson ? fromPerson.name : 'Unknown',
       toPerson ? toPerson.name : 'Unknown',
       'file',
       req.file.originalname,
       JSON.stringify({ filename: req.file.filename, original_name: req.file.originalname, mime_type: req.file.mimetype, size: req.file.size }),
       new Date().toISOString()]
    );

    res.json({ success: true, message: { id, from_id, to_id, type: 'file', content: req.file.originalname, metadata: { filename: req.file.filename, original_name: req.file.originalname, mime_type: req.file.mimetype, size: req.file.size }, created_at: new Date().toISOString() } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Serve message files
router.get('/message-files/:filename', requireAuth, (req, res) => {
  const filePath = path.join(__dirname, '../../message-files', req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.download(filePath);
});

module.exports = router;
