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
  const question = req.body.question || 'Analyze this project. Report any missing documents, incomplete loops, mismatches between Excel data and P&ID extractions, and coverage gaps. Prioritize safety-critical instruments.';
    const conversationHistory = req.body.conversationHistory || [];
    const analysisContext = req.body.analysisContext || null;

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

    if (folderCount.total === 0) {
      return res.status(400).json({
        error: 'Project "' + project.name + '" has no loop folders. Upload and process files first.',
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
    // Add analysis findings context if available
    let enrichedQuestion = question;
    if (analysisContext) {
      enrichedQuestion = 'ANALYSIS CONTEXT (results from programmatic folder analysis on this P&ID):
' + analysisContext + '

USER QUESTION: ' + question;
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
      executeTool: projectIntelligence.executeTool,
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

module.exports = router;
