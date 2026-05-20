/**
 * Support Messaging Routes
 * Handles customer ↔ Sparks support conversations
 */
const { Router } = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const DB = require('../../database/db');
const { requireAuth, requireSparksRole } = require('../middleware/sessionAuth');
const { callClaude } = require('../services/ai/anthropicClient');

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
      content, message_type, app_origin, current_route, screen_context, file_url,
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
      `INSERT INTO support_messages (id, conversation_id, company_id, person_id, person_name, person_role, company_name, sender_type, content, message_type, file_url, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'customer', $8, $9, $10, NOW())`,
      [msg_id, conversation_id, company_id, person_id, person_name, person_role, company_name, content, message_type || 'text', file_url || null]
    );

    // Update conversation
    await DB.db.query(
      "UPDATE support_conversations SET last_message = $1, last_message_at = NOW(), updated_at = NOW(), status = 'open' WHERE id = $2",
      [content.substring(0, 200), conversation_id]
    );

    // Check if support is offline to customize the prompt (AI always responds in hybrid mode)
    let activeAgents = 0;
    try {
      const activeCheck = await DB.db.query(`
        SELECT count(*)::int as count
        FROM app_sessions s
        JOIN people p ON s.person_id = p.id
        WHERE p.sparks_role IN ('admin', 'support', 'collaborator')
          AND s.last_seen_at > NOW() - INTERVAL '15 minutes'
      `);
      activeAgents = activeCheck.rows[0]?.count || 0;
    } catch (e) {
      console.error('Active check error during send:', e);
    }

    const nowTime = new Date();
    const dayOfWeek = nowTime.getDay();
    const hourOfDay = nowTime.getHours();
    const isBusinessHours = dayOfWeek >= 1 && dayOfWeek <= 5 && hourOfDay >= 9 && hourOfDay < 17;
    const isOffline = activeAgents === 0 && !isBusinessHours;

    // Trigger async auto-reply (Always enabled in hybrid mode)
    setImmediate(async () => {
      try {
        // Human takeover check: If a human operator has already replied to this
        // conversation, the AI should step back.
        const { rows: humanCheckPre } = await DB.db.query(
          "SELECT id FROM support_messages WHERE conversation_id = $1 AND sender_type = 'support' AND person_name != 'Sparks AI' LIMIT 1",
          [conversation_id]
        );
        if (humanCheckPre.length > 0) {
          return;
        }

        // Build context for Claude
        const systemPrompt = `You are Sparks AI, the helpful technical support assistant for Horizon Sparks.
${isOffline 
  ? 'The human support operators are currently OFFLINE (outside business hours or away). Acknowledge that support is currently offline and their message has been queued for human review.' 
  : 'The human support operators are currently ONLINE and can intervene to take over this conversation at any moment. Acknowledge that human operators are online and may jump in, but you are responding immediately to assist them in the meantime.'}
Your job is to read the customer's message and their page/screen context, and provide a helpful, polite, and professional automatic response.
Then, answer their question as best as you can using your general engineering and Horizon Sparks knowledge based on their query.
If they provided context like a P&ID, drawing number, or a specific page/URL, take that into account!
Detect the user's language and respond in the same language (e.g., reply in Spanish if the user writes in Spanish, or English if they write in English).
Keep your response concise, clear, and reassuring. Do not use markdown syntax that requires rendering features not supported in simple text blocks, but standard bold/italics are fine.`;

          // Load conversation history (including the message just sent)
          const { rows: history } = await DB.db.query(
            "SELECT sender_type, content, message_type FROM support_messages WHERE conversation_id = $1 ORDER BY created_at ASC",
            [conversation_id]
          );

          // Get screen context from the conversation itself
          // NOTE: The column storing UI context is named `screen_context_json` in the DB.
          // If the column does not exist (legacy DB), we fallback to an empty object.
          let screen_context = {};
          let currentRoute = null;
          let customerName = null;
          try {
            const { rows: convo } = await DB.db.query(
              "SELECT screen_context, current_route, person_name FROM support_conversations WHERE id = $1",
              [conversation_id]
            );
            const convoRow = convo[0] || {};
            screen_context = convoRow.screen_context || {};
            currentRoute = convoRow.current_route;
            customerName = convoRow.person_name;
          } catch (colErr) {
            // If the column truly does not exist, log the error and continue with empty context.
            console.error('Support auto-reply: screen_context column missing – proceeding with empty context', colErr);
            const { rows: convo } = await DB.db.query(
              "SELECT current_route, person_name FROM support_conversations WHERE id = $1",
              [conversation_id]
            );
            const convoRow = convo[0] || {};
            currentRoute = convoRow.current_route;
            customerName = convoRow.person_name;
          }

          // `customerName`, `currentRoute`, and `screenCtx` are now set above.
          const screenCtx = screen_context;

          // Construct messages list for Claude
          const formattedMessages = [];
          
          // Inject context details into the first user message
          let contextStr = `Customer Name: ${customerName}\nCurrent Route: ${currentRoute}\nScreen Context: ${JSON.stringify(screenCtx)}\n\n`;
          
          history.forEach((m, idx) => {
            let contentStr = m.content;
            if (idx === 0) {
              contentStr = contextStr + contentStr;
            }
            formattedMessages.push({
              role: m.sender_type === 'customer' ? 'user' : 'assistant',
              content: contentStr
            });
          });

          // Call Claude
          const result = await callClaude({
            systemPrompt,
            messages: formattedMessages,
            tracking: {
              personId: person_id,
              companyId: company_id,
              service: 'support-autoreply',
              extra: {
                project_id: screenCtx.projectId || 'default'
              }
            }
          });

          if (result.text) {
            // Double check: Has a human operator replied during the ~2 seconds Claude was thinking?
            const { rows: humanCheckPost } = await DB.db.query(
              "SELECT id FROM support_messages WHERE conversation_id = $1 AND sender_type = 'support' AND person_name != 'Sparks AI' LIMIT 1",
              [conversation_id]
            );
            if (humanCheckPost.length > 0) {
              console.log(`Support auto-reply: human intervention detected for ${conversation_id} during thinking. Aborting AI reply.`);
              return;
            }

            // Save Claude's reply to DB
            const replyMsgId = 'smsg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
            await DB.db.query(
              `INSERT INTO support_messages (id, conversation_id, company_id, person_id, person_name, sender_type, content, message_type, created_at)
               VALUES ($1, $2, $3, $4, $5, 'support', $6, 'text', NOW())`,
              [replyMsgId, conversation_id, company_id, person_id, 'Sparks AI', result.text]
            );

            // Update conversation's last message
            await DB.db.query(
              "UPDATE support_conversations SET last_message = $1, last_message_at = NOW(), updated_at = NOW(), status = 'waiting' WHERE id = $2",
              [result.text.substring(0, 200), conversation_id]
            );
          }
        } catch (autoErr) {
          console.error('Failed to generate offline auto-reply:', autoErr);
        }
      });

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
      'SELECT id, sender_type, content, message_type, file_url, read_at, created_at FROM support_messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [convos[0].id]
    );
    res.json({ conversation_id: convos[0].id, messages });
  } catch (err) {
    console.error('Support my-conversation error:', err);
    res.status(500).json({ error: 'Failed to load conversation' });
  }
});

// GET /api/support/status — Check if support is online
router.get('/status', requireAuth, async (req, res) => {
  try {
    const { rows } = await DB.db.query(`
      SELECT count(*)::int as count
      FROM app_sessions s
      JOIN people p ON s.person_id = p.id
      WHERE p.sparks_role IN ('admin', 'support', 'collaborator')
        AND s.last_seen_at > NOW() - INTERVAL '15 minutes'
    `);
    const activeAgents = rows[0]?.count || 0;

    // Fallback: check business hours (Mon-Fri 9:00 - 17:00 local server time)
    const now = new Date();
    const day = now.getDay();
    const hour = now.getHours();
    const isBusinessHours = day >= 1 && day <= 5 && hour >= 9 && hour < 17;

    res.json({
      online: activeAgents > 0 || isBusinessHours,
      active_agents: activeAgents,
    });
  } catch (err) {
    const now = new Date();
    const day = now.getDay();
    const hour = now.getHours();
    res.json({
      online: day >= 1 && day <= 5 && hour >= 9 && hour < 17,
      active_agents: 0,
    });
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
    const { content, message_type, file_url } = req.body;
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
      `INSERT INTO support_messages (id, conversation_id, person_id, person_name, sender_type, content, message_type, file_url, created_at)
       VALUES ($1, $2, $3, $4, 'support', $5, $6, $7, NOW())`,
      [msg_id, conversation_id, req.auth.person_id, support_name, content, message_type || 'text', file_url || null]
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

// POST /api/support/read — Mark support messages as read
router.post('/read', requireAuth, async (req, res) => {
  try {
    const isIntegration = !!req.auth.isIntegration;
    const person_id = isIntegration ? (req.body.as_person_id || req.query.as_person_id) : req.auth.person_id;
    if (!person_id) return res.json({ success: true });

    // Find the active conversation
    const { rows: convos } = await DB.db.query(
      "SELECT id FROM support_conversations WHERE person_id = $1 AND status != 'resolved' ORDER BY updated_at DESC LIMIT 1",
      [person_id]
    );

    if (convos.length > 0) {
      await DB.db.query(
        "UPDATE support_messages SET read_at = NOW() WHERE conversation_id = $1 AND sender_type = 'support' AND read_at IS NULL",
        [convos[0].id]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Support read error:', err);
    res.status(500).json({ error: 'Failed to mark messages as read' });
  }
});

// File upload configuration for support
const msgFileDir = path.join(__dirname, '../../message-files');
if (!fs.existsSync(msgFileDir)) fs.mkdirSync(msgFileDir, { recursive: true });

const supportFileStorage = multer.diskStorage({
  destination: msgFileDir,
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, 'support_' + Date.now() + '_' + safeName);
  }
});
const supportFileUpload = multer({ storage: supportFileStorage, limits: { fileSize: 50 * 1024 * 1024 } });

// POST /api/support/upload — Upload attachment for support messages
router.post('/upload', requireAuth, supportFileUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({
      filename: req.file.filename,
      original_name: req.file.originalname
    });
  } catch (err) {
    console.error('Support upload error:', err);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// GET /api/support/files/:filename — Download/serve support message attachment securely
router.get('/files/:filename', requireAuth, (req, res) => {
  const filePath = path.join(__dirname, '../../message-files', req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.download(filePath);
});

module.exports = router;
