/**
 * Support Messaging Routes
 * Handles customer ↔ Sparks support conversations
 */
const { Router } = require('express');
const crypto = require('crypto');
const DB = require('../../database/db');
const { requireAuth, requireSparksRole } = require('../middleware/sessionAuth');

const router = Router();

// Defense-in-depth: the integration key currently mints an admin-equivalent
// session (see middleware/sessionAuth.js loadSession), which is broader than
// the support-chat use case requires. This guard blocks integration callers
// from hitting any route that lists/reads/replies/resolves OTHER customers'
// conversations. They are limited to /send and /my-conversation, both of
// which are scoped to a single as_person_id supplied by the trusted proxy.
function denyIntegration(req, res, next) {
  if (req.auth && req.auth.isIntegration) {
    return res.status(403).json({ error: 'Integration tokens cannot access operator-side support routes' });
  }
  return next();
}

// ============================================
// CUSTOMER SIDE — send support message
// ============================================

// POST /api/support/send — Customer sends a message
//
// Two ways to authenticate:
//   1. Cookie session (in-app Voice Report user)
//   2. Integration key (X-Integration-Key) + as_person_id/as_company_id body fields
//      — used by PIDS-app's Next.js server-side proxy to forward customer messages
//      with the REAL customer identity (instead of the generic 'integration' user).
router.post('/send', requireAuth, async (req, res) => {
  try {
    const {
      content, message_type, app_origin, current_route, screen_context,
      as_person_id, as_company_id, as_person_name, as_person_role, as_company_name,
    } = req.body;
    if (!content) return res.status(400).json({ error: 'Message content required' });

    // When the caller is an integration (PIDS-app proxy), accept the body's
    // identity overrides; otherwise lock to the real session identity.
    const isIntegration = !!req.auth.isIntegration;
    if (isIntegration && !as_person_id) {
      return res.status(400).json({ error: 'as_person_id required for integration auth' });
    }
    const person_id  = isIntegration ? as_person_id : req.auth.person_id;
    const company_id = isIntegration ? (as_company_id || null) : req.auth.company_id;
    if (!person_id) return res.status(400).json({ error: 'person_id required' });

    // Validate app_origin against the schema CHECK constraint to fail early
    // (otherwise INSERT would 500 on a bad value).
    const origin = (app_origin === 'pids-app') ? 'pids-app' : 'voicereport';
    const route  = typeof current_route === 'string' ? current_route.slice(0, 500) : null;
    const ctx    = (screen_context && typeof screen_context === 'object') ? screen_context : null;

    // Get person details — DB lookup, with integration body overrides as fallback.
    // PIDS-app users may not have a row in voicereport.people (different auth realm),
    // so the as_* fields are the source of truth when DB returns nothing.
    let person_name = isIntegration ? (as_person_name || 'Unknown') : 'Unknown';
    let person_role = isIntegration ? (as_person_role || '') : '';
    let company_name = isIntegration ? (as_company_name || '') : '';
    try {
      const { rows } = await DB.db.query('SELECT name, role_title FROM people WHERE id = $1', [person_id]);
      if (rows[0]) { person_name = rows[0].name; person_role = rows[0].role_title || ''; }
    } catch {}
    try {
      if (company_id) {
        const { rows } = await DB.db.query('SELECT name FROM companies WHERE id = $1', [company_id]);
        if (rows[0]) company_name = rows[0].name;
      }
    } catch {}

    // Find or create conversation
    let conversation_id;
    const { rows: existing } = await DB.db.query(
      "SELECT id FROM support_conversations WHERE person_id = $1 AND status != 'resolved' ORDER BY updated_at DESC LIMIT 1",
      [person_id]
    );

    if (existing.length > 0) {
      conversation_id = existing[0].id;
      // Refresh route + context on every customer message so the operator
      // sees where they are NOW, not where they were when the thread opened.
      await DB.db.query(
        `UPDATE support_conversations
            SET app_origin = $1, current_route = $2, screen_context = $3
          WHERE id = $4`,
        [origin, route, ctx, conversation_id]
      );
    } else {
      conversation_id = 'conv_' + crypto.randomUUID().slice(0, 12);
      await DB.db.query(
        `INSERT INTO support_conversations
           (id, company_id, person_id, person_name, person_role, company_name,
            status, app_origin, current_route, screen_context, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9, NOW(), NOW())`,
        [conversation_id, company_id, person_id, person_name, person_role,
         company_name, origin, route, ctx]
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
//
// Same dual-auth dance as POST /send: when called via integration key the
// caller passes ?as_person_id=<keycloak_sub> so we scope the lookup to the
// real customer instead of the generic integration user. Without that the
// PIDS-app proxy would always return the integration user's thread.
router.get('/my-conversation', requireAuth, async (req, res) => {
  try {
    const isIntegration = !!req.auth.isIntegration;
    if (isIntegration && !req.query.as_person_id) {
      return res.status(400).json({ error: 'as_person_id query param is required for integration auth' });
    }
    const person_id = isIntegration ? req.query.as_person_id : req.auth.person_id;
    if (!person_id) return res.json({ messages: [] });

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
router.get('/inbox', requireAuth, denyIntegration, requireSparksRole('support'), async (req, res) => {
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
router.get('/conversation/:id', requireAuth, denyIntegration, requireSparksRole('support'), async (req, res) => {
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
router.post('/reply/:id', requireAuth, denyIntegration, requireSparksRole('support'), async (req, res) => {
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
router.post('/resolve/:id', requireAuth, denyIntegration, requireSparksRole('support'), async (req, res) => {
  try {
    await DB.db.query("UPDATE support_conversations SET status = 'resolved', updated_at = NOW() WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Support resolve error:', err);
    res.status(500).json({ error: 'Failed to resolve conversation' });
  }
});

// GET /api/support/unread-count — Quick count of unread conversations (for badge)
router.get('/unread-count', requireAuth, denyIntegration, requireSparksRole('advisor'), async (req, res) => {
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
