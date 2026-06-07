/**
 * Support Messaging Routes
 * Handles customer ↔ Sparks support conversations
 */
const { Router } = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const DB = require('../../database/db');
const { requireAuth, requireSparksRole } = require('../middleware/sessionAuth');
const { uploadLimiter } = require('../middleware/rateLimiters');
const { callClaude } = require('../services/ai/anthropicClient');

const router = Router();

// Rate limit for customer-facing /send: 30 msgs/minute per person to deter
// spam and protect Claude API spend. Operators and integration callers are
// also keyed by person_id so a single misbehaving tenant cannot starve
// others. Falls back to req.ip when person_id is missing.
const sendRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  // For integration auth (PIDS-app proxy), req.auth.person_id is the shared
  // literal 'integration', so we'd throttle all tenants into the same bucket.
  // Prefer the customer-supplied as_person_id to isolate per real customer.
  keyGenerator: (req) => {
    // IPv6 hardening — see [[rateLimiters]] for why we wrap req.ip.
    if (req.auth && req.auth.isIntegration) {
      return (req.body && req.body.as_person_id) || (req.query && req.query.as_person_id) || ipKeyGenerator(req.ip);
    }
    return (req.auth && req.auth.person_id) || ipKeyGenerator(req.ip);
  },
  message: { error: 'Too many messages — please slow down and try again in a minute.' },
});

// Best-effort audit logger. Failures here should NEVER block the action
// that triggered them — losing a log entry is worse than losing the action.
async function logEvent(conversation_id, actor_person_id, action, payload) {
  try {
    await DB.db.query(
      `INSERT INTO support_conversation_events (conversation_id, actor_person_id, action, payload)
       VALUES ($1, $2, $3, $4)`,
      [conversation_id, actor_person_id || null, action, payload ? JSON.stringify(payload) : null]
    );
  } catch (err) {
    console.error('Audit log error:', err);
  }
}

// Parses a "CONFIDENCE: 0.XX" footer the AI is asked to append. Tolerant:
// the marker can appear on any line, with optional punctuation/text after
// the value. ALWAYS strips every CONFIDENCE line from cleanText even if
// the value fails to parse — better to drop a meaningless marker than leak
// "CONFIDENCE: …" to customers when the model deviates from format.
function extractAiConfidence(text) {
  if (typeof text !== 'string') return { confidence: null, cleanText: text };
  let confidence = null;
  const m = text.match(/(?:^|\n)\s*CONFIDENCE\s*[:=]?\s*(0(?:\.\d+)?|1(?:\.0+)?)/i);
  if (m) {
    const v = parseFloat(m[1]);
    if (Number.isFinite(v)) confidence = Math.max(0, Math.min(1, v));
  }
  const cleanText = text
    .replace(/(?:^|\n)[^\n]*CONFIDENCE[^\n]*/gi, '')
    .trim();
  return { confidence, cleanText };
}

// Business hours are evaluated in this timezone, NOT the server's local time,
// so the customer-facing offline banner and the auto-reply prompt stay correct
// regardless of where the container is hosted. Override via env if Sparks moves.
const SUPPORT_TIMEZONE = process.env.SUPPORT_TIMEZONE || 'America/Mexico_City';
// Fail loud (once) on a typo'd timezone so it doesn't silently fall back to
// "always offline" without anyone noticing.
try {
  new Intl.DateTimeFormat('en-US', { timeZone: SUPPORT_TIMEZONE });
} catch (err) {
  console.error(`[support] Invalid SUPPORT_TIMEZONE="${SUPPORT_TIMEZONE}":`, err.message);
}
function isBusinessHoursNow() {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: SUPPORT_TIMEZONE,
      weekday: 'short',
      hour: 'numeric',
      hour12: false,
    }).formatToParts(new Date());
    const weekday = parts.find(p => p.type === 'weekday')?.value;
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value, 10);
    if (!weekday || !Number.isFinite(hour)) return false;
    return !['Sat', 'Sun'].includes(weekday) && hour >= 9 && hour < 17;
  } catch {
    return false;
  }
}

// Window (minutes) during which the AI auto-reply backs off after a human
// operator sends a message. Once the window passes, the AI resumes helping
// — supports the soft-handoff pattern where a human steps in, resolves the
// active thread of conversation, then leaves. Operators can shorten the
// window for a specific conversation by hitting POST /release-ai/:id.
// Override globally via env without redeploying code.
const AUTO_REPLY_HUMAN_BACKOFF_MINUTES = Math.max(
  1,
  parseInt(process.env.SUPPORT_AI_BACKOFF_MINUTES, 10) || 3
);

// AI cost throttling.
//
// SUPPORT_AI_HISTORY_LIMIT caps how many prior messages are sent to Claude
// per call. Without this, long conversations balloon token usage on every
// new message (full history is re-sent each time). 20 messages = enough
// context for continuity, ~80% cost reduction on long threads.
//
// SUPPORT_AI_TRIVIAL_THRESHOLD: messages this short or shorter (after trim,
// with no question mark and no digits) are answered with a canned "👍"
// instead of calling Claude. Default 3 catches "ok", "ya", "thx" etc.
// Set to 0 to disable (every message goes to Claude).
// parseInt of undefined returns NaN; nullish-coalescing (??) does NOT
// fall back from NaN to the default. Use Number.isFinite to detect a
// real number first — otherwise SUPPORT_AI_TRIVIAL_THRESHOLD=unset turns
// into NaN, which makes `length > NaN` always false and incorrectly
// treats every message as trivial.
function envInt(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : fallback;
}
const AI_HISTORY_LIMIT = Math.max(4, envInt('SUPPORT_AI_HISTORY_LIMIT', 20));
const AI_TRIVIAL_THRESHOLD = Math.max(0, envInt('SUPPORT_AI_TRIVIAL_THRESHOLD', 3));

// Heuristic: does this message warrant a real Claude call?
// We skip very short messages with no question mark and no digits — those
// are typically acknowledgements ("ok", "ya", "thx 👍") where a canned reply
// is indistinguishable from an LLM response but costs nothing.
function isTrivialAck(content) {
  if (AI_TRIVIAL_THRESHOLD <= 0) return false;
  const trimmed = (content || '').trim();
  if (trimmed.length > AI_TRIVIAL_THRESHOLD) return false;
  if (/[?¿0-9]/.test(trimmed)) return false;
  return true;
}

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
router.post('/send', requireAuth, sendRateLimiter, async (req, res) => {
  try {
    const {
      content, message_type, app_origin, current_route, screen_context, file_url,
      as_person_id, as_company_id, as_person_name, as_person_role, as_company_name,
    } = req.body;
    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'Message content (non-empty string) required' });
    }

    // Support staff must use /api/support/reply/:id to respond. /send is the
    // customer entry point — if a sparks user POSTs here they'd end up creating
    // a "customer" row attributed to themselves, polluting the data and
    // confusing SLA metrics. Integration auth is allowed (PIDS-app proxy
    // forwards real customer identity).
    //
    // Trim before checking so dirty rows with sparks_role='' still pass through
    // as normal customers — only a non-empty role string blocks /send.
    const sparksRoleTrimmed = (req.auth && typeof req.auth.sparks_role === 'string')
      ? req.auth.sparks_role.trim()
      : '';
    if (sparksRoleTrimmed && !req.auth.isIntegration) {
      return res.status(403).json({
        error: 'Support staff cannot initiate customer messages via /send. Use /reply/:id from the operator inbox.',
      });
    }

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

    // Find or create conversation. Includes resolved threads on purpose —
    // a customer who returns after resolution gets the SAME thread reopened,
    // preserving history. The prior customer_rating (if any) stays as a
    // snapshot of how the previous resolution went; rating is one-shot
    // (POST /rate returns 409 if already set).
    let conversation_id;
    let reopened = false;
    const { rows: existing } = await DB.db.query(
      "SELECT id, status FROM support_conversations WHERE person_id = $1 ORDER BY updated_at DESC LIMIT 1",
      [person_id]
    );

    if (existing.length > 0) {
      conversation_id = existing[0].id;
      reopened = existing[0].status === 'resolved';
      // Refresh route + context on every customer message so the operator
      // sees where they are NOW, not where they were when the thread opened.
      // If the thread was resolved, flip it back to 'open' so it returns
      // to the operator inbox.
      await DB.db.query(
        `UPDATE support_conversations
            SET app_origin = $1, current_route = $2, screen_context = $3,
                status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END
          WHERE id = $4`,
        [origin, route, ctx, conversation_id]
      );
      if (reopened) {
        logEvent(conversation_id, person_id, 'reopen_by_customer', null);
      }
    } else {
      conversation_id = 'conv_' + crypto.randomUUID().slice(0, 12);
      try {
        await DB.db.query(
          `INSERT INTO support_conversations
             (id, company_id, person_id, person_name, person_role, company_name,
              status, app_origin, current_route, screen_context, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9, NOW(), NOW())`,
          [conversation_id, company_id, person_id, person_name, person_role,
           company_name, origin, route, ctx]
        );
      } catch (insertErr) {
        // 23505 = unique violation against uniq_support_conv_active_person.
        // Another concurrent request opened a thread for this person between
        // our SELECT and INSERT — re-select to pick up its id and continue.
        if (insertErr.code !== '23505') throw insertErr;
        const { rows: raced } = await DB.db.query(
          "SELECT id FROM support_conversations WHERE person_id = $1 AND status != 'resolved' ORDER BY updated_at DESC LIMIT 1",
          [person_id]
        );
        if (raced.length === 0) throw insertErr;
        conversation_id = raced[0].id;
      }
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

    const isOffline = activeAgents === 0 && !isBusinessHoursNow();
    // AI ALWAYS auto-sends a reply to the customer — there is no draft mode.
    // A human operator's reply (via /reply/:id or /accept-suggestion) pauses
    // the AI for AUTO_REPLY_HUMAN_BACKOFF_MINUTES; after that window passes,
    // the AI resumes. The `isOffline` flag below only shapes the AI's tone
    // (acknowledge offline vs. acknowledge online), not whether it sends.

    // Trigger async AI auto-reply
    const trivialAck = isTrivialAck(content);
    setImmediate(async () => {
      try {
        // Human takeover check: skip auto-reply if a human operator (not Sparks
        // AI) has replied within the configured backoff window. Time-based so
        // the AI resumes helping once the human disengages from the thread.
        const { rows: takeoverPre } = await DB.db.query(
          `SELECT 1 FROM support_conversations
            WHERE id = $1
              AND last_support_reply_at > NOW() - $2 * INTERVAL '1 minute'
            LIMIT 1`,
          [conversation_id, AUTO_REPLY_HUMAN_BACKOFF_MINUTES]
        );
        if (takeoverPre.length > 0) {
          return;
        }

        // Cost-throttle: trivial acks ("ok", "thx", "ya") get a canned reply
        // — same "AI always intervenes" UX, but zero Claude tokens. We still
        // stamp is_ai=true and ai_confidence=1.0 so the row is identifiable
        // as an AI-generated response in audit/analytics.
        if (trivialAck) {
          const ackId = 'smsg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
          await DB.db.query(
            `INSERT INTO support_messages (id, conversation_id, company_id, person_id, person_name, sender_type, content, message_type, is_ai, ai_confidence, created_at)
             VALUES ($1, $2, $3, $4, $5, 'support', $6, 'text', true, 1.0, NOW())`,
            [ackId, conversation_id, company_id, person_id, 'Sparks AI', '👍']
          );
          await DB.db.query(
            "UPDATE support_conversations SET last_message = $1, last_message_at = NOW(), updated_at = NOW(), status = 'waiting' WHERE id = $2",
            ['👍', conversation_id]
          );
          return;
        }

        // Build context for Claude. Single prompt — the AI always sends the
        // reply directly to the customer. Online/offline only shapes the
        // acknowledgement wording, not whether the reply is sent.
        const confidenceFooter = `

After your reply, on its OWN final line, output exactly:
CONFIDENCE: 0.XX
where 0.XX is your self-rated confidence (0.00-1.00) that the reply is accurate and complete given the available context. The operator dashboard uses this to flag low-confidence answers for review.`;
        const operatorStatusLine = isOffline
          ? 'The human support operators are currently OFFLINE (outside business hours or away). Acknowledge that support is currently offline and a human will follow up.'
          : 'The human support operators are currently ONLINE and may jump in to take over the conversation at any moment. Reassure the customer that a human can intervene, but answer their question immediately so they are not blocked waiting.';
        const systemPrompt = `You are Sparks AI, the helpful technical support assistant for Horizon Sparks.
${operatorStatusLine}
Answer their question using your general engineering and Horizon Sparks knowledge. If they provided context like a P&ID, drawing number, or a specific page/URL, incorporate it.
Detect the user's language and respond in the same language (e.g. reply in Spanish if the user writes in Spanish, English if they write English).
Keep your response concise, clear, and reassuring. Standard bold/italics are fine, but no markdown that requires special rendering.` + confidenceFooter;

          // Load conversation history (including the message just sent),
          // capped to the last AI_HISTORY_LIMIT messages. Selecting DESC + reverse
          // ensures we get the MOST RECENT slice; without the limit, a long-
          // running conversation would re-send hundreds of messages to Claude
          // on every new customer turn, ballooning token cost linearly.
          const { rows: historyDesc } = await DB.db.query(
            "SELECT sender_type, content, message_type FROM support_messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2",
            [conversation_id, AI_HISTORY_LIMIT]
          );
          const history = historyDesc.reverse();

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
            // Double check after Claude returns: has a human replied during
            // the API call window? Same time-based gate as the pre-check.
            const { rows: takeoverPost } = await DB.db.query(
              `SELECT 1 FROM support_conversations
                WHERE id = $1
                  AND last_support_reply_at > NOW() - $2 * INTERVAL '1 minute'
                LIMIT 1`,
              [conversation_id, AUTO_REPLY_HUMAN_BACKOFF_MINUTES]
            );
            if (takeoverPost.length > 0) {
              console.log(`Support auto-reply: human intervention detected for ${conversation_id} during thinking. Aborting AI reply.`);
              return;
            }

            const { confidence: ai_confidence, cleanText } = extractAiConfidence(result.text);

            {
              // AI always sends directly to the customer as a new support_messages row.
              const replyMsgId = 'smsg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
              await DB.db.query(
                `INSERT INTO support_messages (id, conversation_id, company_id, person_id, person_name, sender_type, content, message_type, is_ai, ai_confidence, created_at)
                 VALUES ($1, $2, $3, $4, $5, 'support', $6, 'text', true, $7, NOW())`,
                [replyMsgId, conversation_id, company_id, person_id, 'Sparks AI', cleanText, ai_confidence]
              );

              // Update conversation's last message
              await DB.db.query(
                "UPDATE support_conversations SET last_message = $1, last_message_at = NOW(), updated_at = NOW(), status = 'waiting' WHERE id = $2",
                [cleanText.substring(0, 200), conversation_id]
              );
            }
          }
        } catch (autoErr) {
          console.error('Failed to generate offline auto-reply:', autoErr);
        }
      });

    res.json({ success: true, conversation_id, message_id: msg_id, status: 'open' });
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

    // Customer needs to see resolved conversations too so the CSAT prompt
    // can render after resolution. We pick the most recently updated thread
    // regardless of status; the UI gates rating to status === 'resolved'.
    const { rows: convos } = await DB.db.query(
      `SELECT id, status, customer_rating
         FROM support_conversations
        WHERE person_id = $1
        ORDER BY updated_at DESC
        LIMIT 1`,
      [person_id]
    );
    if (convos.length === 0) return res.json({ messages: [] });

    const { rows: messages } = await DB.db.query(
      'SELECT id, sender_type, content, message_type, file_url, read_at, created_at FROM support_messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [convos[0].id]
    );
    res.json({
      conversation_id: convos[0].id,
      status: convos[0].status,
      customer_rating: convos[0].customer_rating,
      messages,
    });
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

    res.json({
      online: activeAgents > 0 || isBusinessHoursNow(),
      active_agents: activeAgents,
    });
  } catch (err) {
    res.json({
      online: isBusinessHoursNow(),
      active_agents: 0,
    });
  }
});

// ============================================
// SPARKS SIDE — Support inbox
// ============================================

// GET /api/support/inbox — All open conversations (Sparks support+)
// Query params: ?page=1&limit=50&origin=voicereport|pids-app
router.get('/inbox', requireAuth, denyIntegration, requireSparksRole('support'), async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit) || 50, 100);
    const page   = Math.max(parseInt(req.query.page)  || 1, 1);
    const offset = (page - 1) * limit;
    const origin = ['voicereport', 'pids-app'].includes(req.query.origin) ? req.query.origin : null;

    const params        = origin ? [limit, offset, origin] : [limit, offset];
    const originClause  = origin ? 'AND sc.app_origin = $3' : '';

    const { rows } = await DB.db.query(`
      SELECT sc.*,
        (SELECT count(*)::int FROM support_messages sm WHERE sm.conversation_id = sc.id AND sm.sender_type = 'customer' AND sm.read_at IS NULL) as unread_count
      FROM support_conversations sc
      WHERE sc.status IN ('open', 'waiting')
        ${originClause}
      ORDER BY sc.last_message_at DESC NULLS LAST
      LIMIT $1 OFFSET $2
    `, params);
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
    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'Message content (non-empty string) required' });
    }

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

    // Stamp last_support_reply_at (backoff gate) + first_response_at (SLA,
    // only on the FIRST human reply per conversation — COALESCE preserves it).
    await DB.db.query(
      `UPDATE support_conversations
          SET last_message = $1, last_message_at = NOW(), updated_at = NOW(),
              status = 'waiting',
              last_support_reply_at = NOW(),
              first_response_at = COALESCE(first_response_at, NOW())
        WHERE id = $2`,
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
    // Stamp resolved_at on the FIRST resolve only — COALESCE preserves the
    // original timestamp if the conversation is re-resolved after a reopen.
    const { rowCount } = await DB.db.query(
      `UPDATE support_conversations
          SET status = 'resolved',
              updated_at = NOW(),
              resolved_at = COALESCE(resolved_at, NOW())
        WHERE id = $1`,
      [req.params.id]
    );
    if (rowCount > 0) {
      logEvent(req.params.id, req.auth.person_id, 'resolve', null);
    }
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

// GET /api/support/my-unread-count — Customer unread badge count
router.get('/my-unread-count', requireAuth, async (req, res) => {
  try {
    const isIntegration = !!req.auth.isIntegration;
    const person_id = isIntegration ? req.query.as_person_id : req.auth.person_id;
    if (!person_id) return res.json({ unread: 0 });

    const { rows: [{ count }] } = await DB.db.query(`
      SELECT count(*)::int as count
      FROM support_messages sm
      JOIN support_conversations sc ON sm.conversation_id = sc.id
      WHERE sc.person_id = $1
        AND sc.status != 'resolved'
        AND sm.sender_type = 'support'
        AND sm.read_at IS NULL
    `, [person_id]);
    res.json({ unread: count });
  } catch (err) {
    res.json({ unread: 0 });
  }
});

// GET /api/support/resolved — Resolved conversations history (Sparks support+)
// Query params: ?page=1&limit=20&origin=voicereport|pids-app
router.get('/resolved', requireAuth, denyIntegration, requireSparksRole('support'), async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit) || 20, 100);
    const page   = Math.max(parseInt(req.query.page)  || 1, 1);
    const offset = (page - 1) * limit;
    const origin = ['voicereport', 'pids-app'].includes(req.query.origin) ? req.query.origin : null;

    const params       = origin ? [limit, offset, origin] : [limit, offset];
    const originClause = origin ? 'AND sc.app_origin = $3' : '';

    const { rows } = await DB.db.query(`
      SELECT sc.*
      FROM support_conversations sc
      WHERE sc.status = 'resolved'
        ${originClause}
      ORDER BY sc.updated_at DESC
      LIMIT $1 OFFSET $2
    `, params);
    res.json(rows);
  } catch (err) {
    console.error('Support resolved error:', err);
    res.status(500).json({ error: 'Failed to load resolved conversations' });
  }
});

// POST /api/support/reopen/:id — Reopen a resolved conversation
router.post('/reopen/:id', requireAuth, denyIntegration, requireSparksRole('support'), async (req, res) => {
  try {
    const { rowCount } = await DB.db.query(
      "UPDATE support_conversations SET status = 'open', updated_at = NOW() WHERE id = $1 AND status = 'resolved'",
      [req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Conversation not found or not resolved' });
    logEvent(req.params.id, req.auth.person_id, 'reopen', null);
    res.json({ success: true });
  } catch (err) {
    console.error('Support reopen error:', err);
    res.status(500).json({ error: 'Failed to reopen conversation' });
  }
});

// PATCH /api/support/assign/:id — Assign/unassign conversation to a support agent
// Body: { person_id: "..." } or { person_id: null } to unassign
// Requires migration: support_chat_phase_b.sql
router.patch('/assign/:id', requireAuth, denyIntegration, requireSparksRole('support'), async (req, res) => {
  try {
    const { person_id } = req.body;
    if (person_id != null) {
      const { rows } = await DB.db.query(
        "SELECT id FROM people WHERE id = $1 AND sparks_role IN ('admin', 'support')",
        [person_id]
      );
      if (rows.length === 0) return res.status(400).json({ error: 'Person not found or lacks support role' });
    }
    const { rowCount } = await DB.db.query(
      'UPDATE support_conversations SET assigned_to = $1, updated_at = NOW() WHERE id = $2',
      [person_id || null, req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Conversation not found' });
    logEvent(req.params.id, req.auth.person_id, person_id ? 'assign' : 'unassign', { assigned_to: person_id || null });
    res.json({ success: true });
  } catch (err) {
    console.error('Support assign error:', err);
    res.status(500).json({ error: 'Failed to assign conversation' });
  }
});

// POST /api/support/accept-suggestion/:message_id
// Operator accepts (and optionally edits) an AI-generated draft attached to
// a customer's message via support_messages.ai_suggested_reply. Inserts a
// real support reply, clears the suggestion, and stamps SLA timestamps.
router.post('/accept-suggestion/:message_id', requireAuth, denyIntegration, requireSparksRole('support'), async (req, res) => {
  const { content } = req.body;
  const message_id = req.params.message_id;

  // Pre-flight read outside the transaction so we can 4xx without a connection.
  const { rows: orig } = await DB.db.query(
    "SELECT conversation_id, ai_suggested_reply FROM support_messages WHERE id = $1 AND sender_type = 'customer'",
    [message_id]
  );
  if (orig.length === 0) return res.status(404).json({ error: 'Customer message not found' });
  if (!orig[0].ai_suggested_reply) return res.status(400).json({ error: 'No AI suggestion attached to this message' });

  const conversation_id = orig[0].conversation_id;
  const finalContent = (typeof content === 'string' && content.trim())
    ? content.trim()
    : orig[0].ai_suggested_reply;

  let support_name = 'Horizon Sparks Support';
  try {
    if (req.auth.person_id !== '__admin__') {
      const { rows } = await DB.db.query('SELECT name FROM people WHERE id = $1', [req.auth.person_id]);
      if (rows[0]) support_name = rows[0].name;
    }
  } catch {}

  const reply_id = 'smsg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

  // Insert + clear + update must be atomic. Without a transaction, a partial
  // failure (e.g. clear succeeds, conversation update fails) would leave the
  // operator looking at a sent reply with a stale draft still attached.
  const client = await DB.db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO support_messages (id, conversation_id, person_id, person_name, sender_type, content, message_type, is_ai, created_at)
       VALUES ($1, $2, $3, $4, 'support', $5, 'text', false, NOW())`,
      [reply_id, conversation_id, req.auth.person_id, support_name, finalContent]
    );
    await client.query(
      "UPDATE support_messages SET ai_suggested_reply = NULL WHERE id = $1",
      [message_id]
    );
    await client.query(
      `UPDATE support_conversations
          SET last_message = $1, last_message_at = NOW(), updated_at = NOW(),
              status = 'waiting',
              last_support_reply_at = NOW(),
              first_response_at = COALESCE(first_response_at, NOW())
        WHERE id = $2`,
      [finalContent.substring(0, 200), conversation_id]
    );
    await client.query('COMMIT');
    res.json({ success: true, message_id: reply_id });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Support accept-suggestion error:', err);
    res.status(500).json({ error: 'Failed to accept suggestion' });
  } finally {
    client.release();
  }
});

// POST /api/support/dismiss-suggestion/:message_id
// Operator dismisses an AI draft without sending. Clears ai_suggested_reply
// so the prompt disappears from the UI; no message is created.
router.post('/dismiss-suggestion/:message_id', requireAuth, denyIntegration, requireSparksRole('support'), async (req, res) => {
  try {
    const { rowCount } = await DB.db.query(
      "UPDATE support_messages SET ai_suggested_reply = NULL WHERE id = $1 AND sender_type = 'customer'",
      [req.params.message_id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Customer message not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Support dismiss-suggestion error:', err);
    res.status(500).json({ error: 'Failed to dismiss suggestion' });
  }
});

// POST /api/support/rate/:conversation_id
// Customer rates a RESOLVED conversation 1-5. Only the conversation's
// person can rate; rating cannot be changed once set.
router.post('/rate/:conversation_id', requireAuth, async (req, res) => {
  try {
    const { rating } = req.body;
    const r = Number(rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) {
      return res.status(400).json({ error: 'rating must be an integer 1-5' });
    }

    const isIntegration = !!req.auth.isIntegration;
    const person_id = isIntegration
      ? (req.body.as_person_id || req.query.as_person_id)
      : req.auth.person_id;
    if (!person_id) return res.status(400).json({ error: 'person_id required' });

    const { rows: convo } = await DB.db.query(
      'SELECT person_id, status, customer_rating FROM support_conversations WHERE id = $1',
      [req.params.conversation_id]
    );
    if (convo.length === 0) return res.status(404).json({ error: 'Conversation not found' });
    if (convo[0].person_id !== person_id) return res.status(403).json({ error: 'Not your conversation' });
    if (convo[0].status !== 'resolved') return res.status(400).json({ error: 'Conversation not yet resolved' });
    if (convo[0].customer_rating != null) return res.status(409).json({ error: 'Already rated' });

    await DB.db.query(
      'UPDATE support_conversations SET customer_rating = $1, updated_at = NOW() WHERE id = $2',
      [r, req.params.conversation_id]
    );
    logEvent(req.params.conversation_id, person_id, 'rate', { rating: r });

    res.json({ success: true, rating: r });
  } catch (err) {
    console.error('Support rate error:', err);
    res.status(500).json({ error: 'Failed to save rating' });
  }
});

// PATCH /api/support/notes/:conversation_id
// Operator-only internal notes on a conversation. Never returned to the
// customer (GET /my-conversation does not select this column).
router.patch('/notes/:conversation_id', requireAuth, denyIntegration, requireSparksRole('support'), async (req, res) => {
  try {
    const { notes } = req.body;
    // Cap to 10k chars defensively — operator notes should not be unbounded.
    const safe = (typeof notes === 'string') ? notes.slice(0, 10000) : '';
    const { rowCount } = await DB.db.query(
      'UPDATE support_conversations SET internal_notes = $1, updated_at = NOW() WHERE id = $2',
      [safe || null, req.params.conversation_id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Conversation not found' });
    // Notes events log the LENGTH only, not the content — internal_notes can
    // be sensitive and the events table is queried more broadly than the
    // conversations table itself.
    logEvent(req.params.conversation_id, req.auth.person_id, 'notes_update', { length: safe.length });
    res.json({ success: true });
  } catch (err) {
    console.error('Support notes error:', err);
    res.status(500).json({ error: 'Failed to save notes' });
  }
});

// POST /api/support/release-ai/:conversation_id
// Operator explicitly releases the AI backoff for a conversation. Clears
// last_support_reply_at so the next customer message immediately re-engages
// the AI. Useful when the operator has finished their part of the answer
// and wants the bot to handle follow-ups without waiting for the timer.
router.post('/release-ai/:conversation_id', requireAuth, denyIntegration, requireSparksRole('support'), async (req, res) => {
  try {
    const { rowCount } = await DB.db.query(
      'UPDATE support_conversations SET last_support_reply_at = NULL, updated_at = NOW() WHERE id = $1',
      [req.params.conversation_id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Conversation not found' });
    logEvent(req.params.conversation_id, req.auth.person_id, 'release_ai', null);
    res.json({ success: true });
  } catch (err) {
    console.error('Support release-ai error:', err);
    res.status(500).json({ error: 'Failed to release AI' });
  }
});

// GET /api/support/conversation/:id/events — Audit log of state changes
router.get('/conversation/:id/events', requireAuth, denyIntegration, requireSparksRole('support'), async (req, res) => {
  try {
    const { rows } = await DB.db.query(
      `SELECT e.id, e.conversation_id, e.actor_person_id, e.action, e.payload, e.created_at,
              p.name AS actor_name
         FROM support_conversation_events e
         LEFT JOIN people p ON p.id = e.actor_person_id
        WHERE e.conversation_id = $1
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT 200`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Support events error:', err);
    res.status(500).json({ error: 'Failed to load events' });
  }
});

// GET /api/support/sla-metrics
// Rolled-up SLA stats over the last 30 days for operator dashboards.
router.get('/sla-metrics', requireAuth, denyIntegration, requireSparksRole('support'), async (req, res) => {
  try {
    const { rows: [m] } = await DB.db.query(`
      SELECT
        COUNT(*)::int AS conversations_total,
        COUNT(*) FILTER (WHERE first_response_at IS NOT NULL)::int AS conversations_with_response,
        COUNT(*) FILTER (WHERE resolved_at IS NOT NULL)::int AS conversations_resolved,
        ROUND(AVG(EXTRACT(EPOCH FROM (first_response_at - created_at)))
              FILTER (WHERE first_response_at IS NOT NULL))::int AS avg_first_response_seconds,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_response_at - created_at)))
              FILTER (WHERE first_response_at IS NOT NULL))::int AS p50_first_response_seconds,
        ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)))
              FILTER (WHERE resolved_at IS NOT NULL))::int AS avg_resolution_seconds,
        ROUND(AVG(customer_rating) FILTER (WHERE customer_rating IS NOT NULL), 2) AS avg_rating,
        COUNT(customer_rating)::int AS ratings_count
      FROM support_conversations
      WHERE created_at > NOW() - INTERVAL '30 days'
    `);
    res.json(m);
  } catch (err) {
    console.error('SLA metrics error:', err);
    res.status(500).json({ error: 'Failed to compute SLA metrics' });
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

// POST /api/support/upload — Upload attachment for support messages.
// uploadLimiter runs BEFORE multer so we reject the request without parsing
// the file body, sparing disk + memory cost.
router.post('/upload', requireAuth, uploadLimiter, supportFileUpload.single('file'), async (req, res) => {
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

// GET /api/support/files/:filename — Download/serve support message attachment.
// Authz: Sparks staff can fetch any attachment (cross-company by design per
// the team charter). Customers can fetch only attachments referenced by a
// message in a conversation they own.
router.get('/files/:filename', requireAuth, async (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.resolve(msgFileDir, filename);
  if (!filePath.startsWith(path.resolve(msgFileDir) + path.sep)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  const isSupportStaff = !!(req.auth && (
    req.auth.sparks_role === 'support'
    || req.auth.sparks_role === 'admin'
    // NOTE: req.auth.is_admin is role_level>=6 (includes customers) — NOT a support-staff signal.
  ));
  if (!isSupportStaff) {
    const isIntegration = !!(req.auth && req.auth.isIntegration);
    const person_id = isIntegration
      ? ((req.body && req.body.as_person_id) || (req.query && req.query.as_person_id))
      : (req.auth && req.auth.person_id);
    if (!person_id) return res.status(403).json({ error: 'Forbidden' });
    try {
      const { rowCount } = await DB.db.query(
        `SELECT 1
           FROM support_messages sm
           JOIN support_conversations sc ON sc.id = sm.conversation_id
          WHERE sm.file_url = $1 AND sc.person_id = $2
          LIMIT 1`,
        [filename, person_id]
      );
      if (rowCount === 0) return res.status(403).json({ error: 'Forbidden' });
    } catch (err) {
      console.error('Attachment authz error:', err);
      return res.status(500).json({ error: 'Authorization check failed' });
    }
  }

  res.download(filePath);
});

module.exports = router;
