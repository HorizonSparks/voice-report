/**
 * Support Messaging Routes
 * Handles customer ↔ Sparks support conversations
 */
const { Router } = require('express');
const crypto = require('crypto');
const DB = require('../../database/db');
const { requireAuth, requireSparksRole } = require('../middleware/sessionAuth');

const router = Router();

// ============================================
// CUSTOMER SIDE — send support message
// ============================================

// POST /api/support/send — Customer sends a message
router.post('/send', requireAuth, async (req, res) => {
  try {
    const { content, message_type } = req.body;
    if (!content) return res.status(400).json({ error: 'Message content required' });

    const person_id = req.auth.person_id;
    const company_id = req.auth.company_id;

    // Get person details
    let person_name = 'Unknown';
    let person_role = '';
    let company_name = '';
    try {
      const { rows } = await DB.db.query('SELECT name, role_title FROM people WHERE id = $1', [person_id]);
      if (rows[0]) { person_name = rows[0].name; person_role = rows[0].role_title || ''; }
    } catch {}
    try {
      const { rows } = await DB.db.query('SELECT name FROM companies WHERE id = $1', [company_id]);
      if (rows[0]) company_name = rows[0].name;
    } catch {}

    // Find or create conversation
    let conversation_id;
    const { rows: existing } = await DB.db.query(
      "SELECT id FROM support_conversations WHERE person_id = $1 AND status != 'resolved' ORDER BY updated_at DESC LIMIT 1",
      [person_id]
    );

    if (existing.length > 0) {
      conversation_id = existing[0].id;
    } else {
      conversation_id = 'conv_' + crypto.randomUUID().slice(0, 12);
      await DB.db.query(
        `INSERT INTO support_conversations (id, company_id, person_id, person_name, person_role, company_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'open', NOW(), NOW())`,
        [conversation_id, company_id, person_id, person_name, person_role, company_name]
      );
    }

    // Save message
    const msg_id = 'smsg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    await DB.db.query(
      `INSERT INTO support_messages (id, conversation_id, company_id, person_id, person_name, person_role, company_name, sender_type, content, message_type, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'customer', $8, $9, NOW())`,
      [msg_id, conversation_id, company_id, person_id, person_name, person_role, company_name, content, message_type || 'text']
    );

    // Update conversation
    await DB.db.query(
      "UPDATE support_conversations SET last_message = $1, last_message_at = NOW(), updated_at = NOW(), status = 'open' WHERE id = $2",
      [content.substring(0, 200), conversation_id]
    );

    res.json({ success: true, conversation_id, message_id: msg_id });
  } catch (err) {
    console.error('Support send error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// GET /api/support/my-conversation — Customer gets their conversation history
router.get('/my-conversation', requireAuth, async (req, res) => {
  try {
    const person_id = req.auth.person_id;
    const { rows: convos } = await DB.db.query(
      "SELECT id FROM support_conversations WHERE person_id = $1 AND status != 'resolved' ORDER BY updated_at DESC LIMIT 1",
      [person_id]
    );
    if (convos.length === 0) return res.json({ messages: [] });

    const { rows: messages } = await DB.db.query(
      'SELECT id, sender_type, content, message_type, file_url, created_at FROM support_messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [convos[0].id]
    );
    res.json({ conversation_id: convos[0].id, messages });
  } catch (err) {
    console.error('Support my-conversation error:', err);
    res.status(500).json({ error: 'Failed to load conversation' });
  }
});

// ============================================
// SPARKS SIDE — Support inbox
// ============================================

// GET /api/support/inbox — All open conversations (Sparks support+)
router.get('/inbox', requireAuth, requireSparksRole('support'), async (req, res) => {
  try {
    const { rows } = await DB.db.query(`
      SELECT sc.*,
        (SELECT count(*)::int FROM support_messages sm WHERE sm.conversation_id = sc.id AND sm.sender_type = 'customer' AND sm.read_at IS NULL) as unread_count
      FROM support_conversations sc
      WHERE sc.status IN ('open', 'waiting')
      ORDER BY sc.last_message_at DESC NULLS LAST
    `);
    res.json(rows);
  } catch (err) {
    console.error('Support inbox error:', err);
    res.status(500).json({ error: 'Failed to load inbox' });
  }
});

// GET /api/support/conversation/:id — Get full conversation (Sparks support+)
router.get('/conversation/:id', requireAuth, requireSparksRole('support'), async (req, res) => {
  try {
    const { rows: messages } = await DB.db.query(
      'SELECT * FROM support_messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );

    // Mark customer messages as read
    await DB.db.query(
      "UPDATE support_messages SET read_at = NOW() WHERE conversation_id = $1 AND sender_type = 'customer' AND read_at IS NULL",
      [req.params.id]
    );

    // Get conversation info
    const { rows: [convo] } = await DB.db.query('SELECT * FROM support_conversations WHERE id = $1', [req.params.id]);

    res.json({ conversation: convo, messages });
  } catch (err) {
    console.error('Support conversation error:', err);
    res.status(500).json({ error: 'Failed to load conversation' });
  }
});

// POST /api/support/reply/:id — Sparks replies to a conversation
router.post('/reply/:id', requireAuth, requireSparksRole('support'), async (req, res) => {
  try {
    const { content, message_type } = req.body;
    if (!content) return res.status(400).json({ error: 'Message content required' });

    const conversation_id = req.params.id;

    // Get support person name
    let support_name = 'Horizon Sparks Support';
    try {
      if (req.auth.person_id !== '__admin__') {
        const { rows } = await DB.db.query('SELECT name FROM people WHERE id = $1', [req.auth.person_id]);
        if (rows[0]) support_name = rows[0].name;
      }
    } catch {}

    const msg_id = 'smsg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    await DB.db.query(
      `INSERT INTO support_messages (id, conversation_id, person_id, person_name, sender_type, content, message_type, created_at)
       VALUES ($1, $2, $3, $4, 'support', $5, $6, NOW())`,
      [msg_id, conversation_id, req.auth.person_id, support_name, content, message_type || 'text']
    );

    // Update conversation
    await DB.db.query(
      "UPDATE support_conversations SET last_message = $1, last_message_at = NOW(), updated_at = NOW(), status = 'waiting' WHERE id = $2",
      [content.substring(0, 200), conversation_id]
    );

    res.json({ success: true, message_id: msg_id });
  } catch (err) {
    console.error('Support reply error:', err);
    res.status(500).json({ error: 'Failed to send reply' });
  }
});

// POST /api/support/resolve/:id — Mark conversation as resolved
router.post('/resolve/:id', requireAuth, requireSparksRole('support'), async (req, res) => {
  try {
    await DB.db.query("UPDATE support_conversations SET status = 'resolved', updated_at = NOW() WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Support resolve error:', err);
    res.status(500).json({ error: 'Failed to resolve conversation' });
  }
});

// GET /api/support/unread-count — Quick count of unread conversations (for badge)
router.get('/unread-count', requireAuth, requireSparksRole('advisor'), async (req, res) => {
  try {
    const { rows: [{ count }] } = await DB.db.query(`
      SELECT count(DISTINCT sc.id)::int as count
      FROM support_conversations sc
      JOIN support_messages sm ON sm.conversation_id = sc.id
      WHERE sc.status IN ('open', 'waiting')
        AND sm.sender_type = 'customer'
        AND sm.read_at IS NULL
    `);
    res.json({ unread: count });
  } catch (err) {
    res.json({ unread: 0 });
  }
});

module.exports = router;
