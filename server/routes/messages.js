const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const DB = require('../../database/db');
const { requireAuth, requireRoleLevel } = require('../middleware/sessionAuth');
const { getActor, canMessage } = require('../auth/authz');

const router = Router();

// Legacy messages — require auth, derive person from session
router.get('/messages/:person_id', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    // Can only read own legacy messages unless admin/supervisor
    if (actor.person_id !== req.params.person_id && !actor.is_admin && actor.role_level < 3) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    res.json(await DB.legacyMessages.getForPerson(req.params.person_id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/messages/:person_id', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    // Only admin/supervisors can send legacy messages
    if (!actor.is_admin && actor.role_level < 3) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    let msgs = await DB.legacyMessages.getForPerson(req.params.person_id);
    const msg = {
      id: 'msg_' + Date.now(),
      from: actor.is_admin ? 'Admin' : (await DB.people.getById(actor.person_id))?.name || 'Unknown',
      from_role: req.body.from_role || 'Supervisor',
      text: req.body.text,
      created_at: new Date().toISOString(), addressed_in_report: null,
    };
    msgs.push(msg);
    await DB.legacyMessages.save(req.params.person_id, msgs);
    res.json({ success: true, message: msg });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/messages/:person_id/mark-addressed', requireAuth, async (req, res) => {
  try {
    let msgs = await DB.legacyMessages.getForPerson(req.params.person_id);
    const { message_ids, report_id } = req.body;
    msgs = msgs.map(m => message_ids.includes(m.id) ? { ...m, addressed_in_report: report_id } : m);
    await DB.legacyMessages.save(req.params.person_id, msgs);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// V2 messaging — all require auth, derive actor from session
router.get('/v2/contacts/:person_id', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    // Use actor's own person_id for contacts (ignore URL param for self, allow admin override)
    const targetId = actor.is_admin ? req.params.person_id : actor.person_id;
    res.json(await DB.contacts.getForPerson(targetId));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/v2/conversations/:person_id', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    const targetId = actor.is_admin ? req.params.person_id : actor.person_id;
    res.json(await DB.contacts.getConversationList(targetId));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/v2/messages/:person_id/:contact_id', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    // Actor must be one of the parties in the conversation (or admin)
    if (!actor.is_admin && actor.person_id !== req.params.person_id) {
      return res.status(403).json({ error: 'Not authorized to view this conversation' });
    }
    if (!(await DB.contacts.canMessage(req.params.person_id, req.params.contact_id))) {
      return res.status(403).json({ error: 'Not authorized to view this conversation' });
    }
    const msgs = await DB.messages.getConversation(req.params.person_id, req.params.contact_id);
    await DB.db.query('UPDATE messages SET read_at = $1 WHERE to_id = $2 AND from_id = $3 AND read_at IS NULL',
      [new Date().toISOString(), req.params.person_id, req.params.contact_id]);
    res.json(msgs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /v2/messages — DERIVE from_id from session, accept to_id from body
router.post('/v2/messages', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    const { to_id, content, type } = req.body;
    // DERIVE actor — ignore client-sent from_id
    const from_id = actor.person_id;

    if (!from_id || !to_id || !content) return res.status(400).json({ error: 'to_id and content required' });

    // No bypass for safety_alert — always check authorization
    if (!(await canMessage(actor, to_id))) {
      return res.status(403).json({ error: 'Not authorized to message this person.' });
    }
    const fromPerson = from_id ? (await DB.db.query('SELECT name FROM people WHERE id = $1', [from_id])).rows[0] : null;
    const toPerson = (await DB.db.query('SELECT name FROM people WHERE id = $1', [to_id])).rows[0];
    res.json(await DB.messages.create({
      from_id, to_id, from_name: fromPerson?.name || (actor.is_admin ? 'Admin' : ''), to_name: toPerson?.name || '',
      content, type: type || 'text', audio_file: req.body.audio_file || null,
      photo: req.body.photo || null, metadata: req.body.metadata || {},
    }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Group messages — require supervisor role, derive from_id from session
router.post('/v2/messages/group', requireAuth, requireRoleLevel(2), async (req, res) => {
  try {
    const actor = getActor(req);
    const from_id = actor.person_id;
    const { content, type } = req.body;
    if (!content) return res.status(400).json({ error: 'content required' });
    const fromPerson = (await DB.db.query('SELECT name, role_level FROM people WHERE id = $1', [from_id])).rows[0];
    const team = await DB.people.getTeam(from_id);
    const results = [];
    for (const member of team) {
      results.push(await DB.messages.create({
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

router.post('/v2/messages/photo', requireAuth, msgPhotoUpload.single('photo'), async (req, res) => {
  try {
    const actor = getActor(req);
    const from_id = actor.person_id;
    const { to_id } = req.body;
    if (!from_id || !to_id || !req.file) return res.status(400).json({ error: 'to_id and photo required' });
    const fromPerson = (await DB.db.query('SELECT name FROM people WHERE id = $1', [from_id])).rows[0];
    const toPerson = (await DB.db.query('SELECT name FROM people WHERE id = $1', [to_id])).rows[0];
    res.json(await DB.messages.create({
      from_id, to_id, from_name: fromPerson?.name || '', to_name: toPerson?.name || '',
      content: 'Photo', type: 'photo', photo: req.file.filename, metadata: {},
    }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Voice messages — derive from_id from session
const msgAudioDir = path.join(__dirname, '../../message-audio');
if (!fs.existsSync(msgAudioDir)) fs.mkdirSync(msgAudioDir, { recursive: true });
const msgAudioStorage = multer.diskStorage({
  destination: msgAudioDir,
  filename: (req, file, cb) => { const ext = file.originalname.split('.').pop() || 'webm'; cb(null, `msg_${Date.now()}_audio.${ext}`); }
});
const msgAudioUpload = multer({ storage: msgAudioStorage, limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/v2/messages/voice', requireAuth, msgAudioUpload.single('audio'), async (req, res) => {
  try {
    const actor = getActor(req);
    const from_id = actor.person_id;
    const { to_id } = req.body;
    if (!from_id || !to_id || !req.file) return res.status(400).json({ error: 'to_id and audio required' });
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
    const fromPerson = (await DB.db.query('SELECT name FROM people WHERE id = $1', [from_id])).rows[0];
    const toPerson = (await DB.db.query('SELECT name FROM people WHERE id = $1', [to_id])).rows[0];
    res.json(await DB.messages.create({
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
    res.json({ count: (await DB.messages.getUnread(targetId)).length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
