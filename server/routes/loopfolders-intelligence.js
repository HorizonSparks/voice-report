/**
 * LoopFolders Intelligence API
 *
 * POST /api/loopfolders/intelligence/:projectId
 *
 * Runs the Project Intelligence Agent (Claude Opus) against a LoopFolders
 * commissioning project. The agent sees the entire project at a glance,
 * then drills down into specific loop folders, P&IDs, and Excel data
 * using tools to find mismatches, gaps, and missing documents.
 *
 * Separate from projects.js because this targets horizonsparks.projects
 * (LoopFolders schema), not voicereport.projects.
 */

const { Router } = require('express');
const DB = require('../../database/db');
const { requireAuth, requireRoleLevel } = require('../middleware/sessionAuth');
const { getActor } = require('../auth/authz');
const { runAgentWithTools, AgentTimeoutError, AgentGuardrailError } = require('../services/ai/agentRuntime');
const { projectIntelligence } = require('../services/ai/agents');
const { aiLogger } = require('../services/logger');

const router = Router();

// ── Single-flight guard — one analysis per user at a time ───────
const activeRequests = new Map();

// ── Rate limit — max 10 analyses per hour per user ──────────────
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 10;

function checkRateLimit(userId) {
  const now = Date.now();
  let entry = rateLimitMap.get(userId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry = { windowStart: now, count: 0 };
    rateLimitMap.set(userId, entry);
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

// Cleanup stale rate limit entries every 30 minutes (Codex review: memory leak fix)
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of rateLimitMap) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) rateLimitMap.delete(id);
  }
}, 30 * 60 * 1000).unref();

/**
 * POST /api/loopfolders/intelligence/:projectId
 *
 * Body: { question?: string }
 * If no question, defaults to full project analysis.
 *
 * Auth: requireAuth + requireRoleLevel(3) — PM/admin only
 * Isolation: project must exist in horizonsparks.projects
 */
router.post('/:projectId', requireAuth, requireRoleLevel(3), async (req, res) => {
  const actor = getActor(req);
  const personId = actor.person_id;
  const projectId = req.params.projectId;
  const question = typeof req.body.question === 'string' ? req.body.question.substring(0, 2000) : 'Analyze this project. Report any missing documents, incomplete loops, mismatches between Excel data and P&ID extractions, and coverage gaps. Prioritize safety-critical instruments.';

    // Sanitize conversation history — clamp roles, require strings, cap size
    const rawHistory = Array.isArray(req.body.conversationHistory) ? req.body.conversationHistory : [];
    const conversationHistory = rawHistory
      .slice(-6) // max 6 messages
      .filter(m => m && typeof m === 'object')
      .map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user', // clamp to valid roles
        content: typeof m.content === 'string' ? m.content.replace(/<[^>]*>/g, '').substring(0, 1000) : '',
      }))
      .filter(m => m.content.length > 0);

    // Sanitize analysis context — cap size, must be string
    const analysisContext = typeof req.body.analysisContext === 'string'
      ? req.body.analysisContext.substring(0, 5000)
      : null;

    // Sanitize loopFolderGroups — the actual folder data visible on screen
    // Strip control chars, newlines, and instruction-like content to prevent prompt injection
    const sanitizeField = (s, maxLen) => {
      if (typeof s !== 'string') return '';
      return s.replace(/[\x00-\x1f\x7f]/g, '') // strip control characters
              .replace(/\n|\r/g, ' ')             // flatten newlines
              .replace(/^(system|assistant|user|ignore|forget|override)[:]/gi, '') // strip role prefixes
              .trim()
              .substring(0, maxLen);
    };
    const rawLoopFolderGroups = Array.isArray(req.body.loopFolderGroups) ? req.body.loopFolderGroups : [];
    const loopFolderGroups = rawLoopFolderGroups
      .slice(0, 30) // cap at 30 folders — enough context without blowing token budget
      .filter(g => g && typeof g === 'object' && typeof g.loopNumber === 'string')
      .map(g => ({
        loopNumber: sanitizeField(g.loopNumber, 60),
        status: sanitizeField(g.status || '', 20),
        is_locked: g.is_locked === true,
        tags: Array.isArray(g.tags) ? g.tags.slice(0, 10).map(t => ({
          fullTag: sanitizeField(t.fullTag || '', 60),
        })) : [],
      }))
      .filter(g => g.loopNumber.length > 0); // drop entries that became empty after sanitization

  // ── Single-flight guard (set BEFORE any async work to prevent race) ──
  if (activeRequests.has(personId)) {
    return res.status(429).json({
      error: 'Analysis already in progress. Please wait for it to complete.',
    });
  }
  activeRequests.set(personId, Date.now());

  // ── Rate limit ──
  if (!checkRateLimit(personId)) {
    activeRequests.delete(personId);
    return res.status(429).json({
      error: 'Rate limit exceeded. Maximum ' + RATE_LIMIT_MAX + ' analyses per hour.',
    });
  }

  try {
    // ── Verify project exists in LoopFolders ──
    const { rows: [project] } = await DB.db.query(
      'SELECT id, name, company FROM horizonsparks.projects WHERE id = $1',
      [projectId]
    );

    if (!project) {
      return res.status(404).json({ error: 'LoopFolders project not found' });
    }

    // ── Check project has data (Codex review: empty-data guard) ──
    const { rows: [folderCount] } = await DB.db.query(
      'SELECT COUNT(*)::int as total FROM horizonsparks.loopfolder WHERE project_id = $1',
      [projectId]
    );

    // Guard: project must have SOME data (files or saved folders).
    // loopFolderGroups from UI supplements but cannot replace real project data.
    const { rows: [fileCount] } = await DB.db.query(
      'SELECT COUNT(*)::int as total FROM horizonsparks.files WHERE project_id = $1',
      [projectId]
    );
    if (folderCount.total === 0 && fileCount.total === 0) {
      return res.status(400).json({
        error: 'Project "' + project.name + '" has no data. Upload and process files first.',
      });
    }
    aiLogger.info({
      msg: 'project_intelligence_start',
      project_id: projectId,
      project_name: project.name,
      person_id: personId,
      question_length: question.length,
    });

    // Build messages with conversation history and analysis context
    const contextMessages = [];
    // Add previous conversation for continuity
    if (conversationHistory.length > 0) {
      conversationHistory.forEach(m => contextMessages.push(m));
    }
    // Add analysis findings context and on-screen folder data
    let enrichedQuestion = question;
    if (analysisContext) {
      enrichedQuestion = 'ANALYSIS CONTEXT (results from programmatic folder analysis on this P&ID):\n' + analysisContext + '\n\nUSER QUESTION: ' + question;
    }
    // Inject loopFolderGroups so the AI can see what's on screen
    if (loopFolderGroups.length > 0) {
      const folderSummary = loopFolderGroups.map(g => {
        const tags = (g.tags || []).map(t => t.fullTag).filter(Boolean).join(', ');
        return g.loopNumber + (g.status ? ' [' + g.status + ']' : '') + (g.is_locked ? ' [LOCKED]' : '') + (tags ? ' — tags: ' + tags : '');
      }).join('\n');
      enrichedQuestion = 'LOOP FOLDERS VISIBLE ON SCREEN (these are the actual folders the user is looking at right now):\n' + folderSummary + '\n\n' + enrichedQuestion;
    }
    contextMessages.push({ role: 'user', content: enrichedQuestion });

    const result = await runAgentWithTools(projectIntelligence.agent, {
      messages: contextMessages,
      context: { projectId, companyId: req.companyId },
      tracking: {
        personId,
        projectId,
        companyId: req.companyId,
        service: 'project-intelligence',
      },
      executeTool: (toolName, toolInput) => projectIntelligence.executeTool(toolName, toolInput, { projectId }),
    });

    aiLogger.info({
      msg: 'project_intelligence_complete',
      project_id: projectId,
      iterations: result.agent.iterations,
      cost_cents: result.agent.costCents,
      duration_ms: result.agent.durationMs,
      input_tokens: result.usage.input_tokens,
      output_tokens: result.usage.output_tokens,
    });

    // ── Cache analysis for training data (fire-and-forget) ──────────
    // Every analysis becomes a training example for the fine-tuned Boss Agent.
    // This runs async — never blocks the response to the user.
    const loopNums = loopFolderGroups.map(g => g.loopNumber).filter(Boolean);
    DB.db.query(
      `INSERT INTO horizonsparks.ai_analysis_cache
       (project_id, loop_numbers, question, analysis_context, loop_folder_groups,
        analysis_text, reasoning_version, model,
        input_tokens, output_tokens, cost_cents, tool_iterations, duration_ms, person_id, company_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        projectId,
        loopNums,
        question.substring(0, 2000),
        analysisContext ? analysisContext.substring(0, 5000) : null,
        loopFolderGroups.length > 0 ? JSON.stringify(loopFolderGroups) : null,
        result.text,
        'v1.0',
        result.agent.model || 'claude-opus-4',
        result.usage.input_tokens || 0,
        result.usage.output_tokens || 0,
        result.agent.costCents || 0,
        result.agent.iterations || 0,
        result.agent.durationMs || 0,
        // personId may be 'integration' (non-UUID) from proxy requests — use null
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(personId) ? personId : null,
        req.companyId || null,
      ]
    ).then(() => {
      aiLogger.info({ msg: 'analysis_cached', project_id: projectId, loop_count: loopNums.length });
    }).catch(cacheErr => {
      // Cache failures never break the user experience
      aiLogger.warn({ msg: 'analysis_cache_failed', project_id: projectId, error: cacheErr.message });
    });

    res.json({
      analysis: result.text,
      project: { id: project.id, name: project.name },
      usage: {
        input_tokens: result.usage.input_tokens,
        output_tokens: result.usage.output_tokens,
        cost_cents: result.agent.costCents,
        iterations: result.agent.iterations,
        duration_ms: result.agent.durationMs,
        model: result.agent.model,
      },
    });
  } catch (err) {
    if (err instanceof AgentTimeoutError) {
      aiLogger.warn({ msg: 'project_intelligence_timeout', project_id: projectId, error: err.message });
      return res.status(504).json({ error: 'Analysis timed out. The project may be too large for a single analysis. Try asking about a specific area.' });
    }
    if (err instanceof AgentGuardrailError) {
      aiLogger.warn({ msg: 'project_intelligence_guardrail', project_id: projectId, error: err.message, type: err.guardrailType });
      return res.status(422).json({ error: 'Analysis guardrail triggered: ' + err.message });
    }
    aiLogger.error({ msg: 'project_intelligence_error', project_id: projectId, error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Intelligence analysis failed: ' + err.message });
  } finally {
    activeRequests.delete(personId);
  }
});

// ── Training Data Export ─────────────────────────────────────────
// GET /api/loopfolders/intelligence/training-data/export
// Exports cached analyses as JSONL for fine-tuning.
// Admin only (roleLevel 5). Returns streaming JSONL.

router.get('/training-data/export', requireAuth, requireRoleLevel(5), async (req, res) => {
  try {
    const minScore = parseInt(req.query.min_score) || 0;
    const limit = Math.min(parseInt(req.query.limit) || 10000, 10000);

    const { rows } = await DB.db.query(
      `SELECT
         id, question, analysis_context, loop_folder_groups,
         analysis_text, reasoning_version, model,
         input_tokens, output_tokens, created_at
       FROM horizonsparks.ai_analysis_cache
       WHERE (training_quality_score IS NULL OR training_quality_score >= $1)
         AND exported_to_training = false
       ORDER BY created_at
       LIMIT $2`,
      [minScore, limit]
    );

    res.setHeader('Content-Type', 'application/jsonl');
    res.setHeader('Content-Disposition', 'attachment; filename="training_data_' + new Date().toISOString().slice(0,10) + '.jsonl"');

    for (const row of rows) {
      // Build the training input: what the model would receive
      let input = '';
      if (row.loop_folder_groups) {
        const groups = typeof row.loop_folder_groups === 'string'
          ? JSON.parse(row.loop_folder_groups)
          : row.loop_folder_groups;
        const folderSummary = groups.map(g => {
          const tags = (g.tags || []).map(t => t.fullTag).filter(Boolean).join(', ');
          return g.loopNumber + (tags ? ' — tags: ' + tags : '');
        }).join('\n');
        input += 'LOOP FOLDERS:\n' + folderSummary + '\n\n';
      }
      if (row.analysis_context) {
        input += 'ANALYSIS CONTEXT:\n' + row.analysis_context + '\n\n';
      }
      input += 'QUESTION: ' + row.question;

      const example = {
        input: input.trim(),
        output: row.analysis_text,
        metadata: {
          reasoning_version: row.reasoning_version,
          model: row.model,
          tokens: row.input_tokens + row.output_tokens,
          date: row.created_at,
        },
      };

      res.write(JSON.stringify(example) + '\n');
    }

    // Mark only the actually exported rows (not all eligible rows)
    if (rows.length > 0) {
      const exportedIds = rows.map(r => r.id).filter(Boolean);
      if (exportedIds.length > 0) {
        await DB.db.query(
          `UPDATE horizonsparks.ai_analysis_cache
           SET exported_to_training = true
           WHERE id = ANY($1)`,
          [exportedIds]
        );
      }
    }

    res.end();

    aiLogger.info({ msg: 'training_data_exported', count: rows.length });
  } catch (err) {
    aiLogger.error({ msg: 'training_data_export_error', error: err.message });
    res.status(500).json({ error: 'Export failed: ' + err.message });
  }
});

// GET /api/loopfolders/intelligence/training-data/stats
// Quick stats on collected training data
router.get('/training-data/stats', requireAuth, requireRoleLevel(3), async (req, res) => {
  try {
    const { rows: [stats] } = await DB.db.query(
      `SELECT
         COUNT(*)::int as total_analyses,
         COUNT(CASE WHEN exported_to_training THEN 1 END)::int as exported,
         COUNT(CASE WHEN training_quality_score >= 3 THEN 1 END)::int as high_quality,
         COALESCE(SUM(input_tokens + output_tokens), 0)::int as total_tokens,
         COALESCE(SUM(cost_cents), 0)::numeric as total_cost_cents,
         MIN(created_at) as first_analysis,
         MAX(created_at) as last_analysis
       FROM horizonsparks.ai_analysis_cache`
    );

    const goal = 500;
    const progress = Math.min(100, Math.round((stats.total_analyses / goal) * 100));

    res.json({
      ...stats,
      training_goal: goal,
      progress_percent: progress,
      ready_for_finetuning: stats.total_analyses >= goal,
    });
  } catch (err) {
    res.status(500).json({ error: 'Stats failed: ' + err.message });
  }
});

module.exports = router;
