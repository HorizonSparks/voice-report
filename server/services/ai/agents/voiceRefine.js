/**
 * Voice Refine Agent (voice.refine.v1)
 *
 * Wraps buildRefinePrompt which dispatches to buildDialoguePrompt / buildFinalizePrompt /
 * buildEditPrompt based on the refine phase. Used by the /api/refine route for
 * the three refine flows: daily_task, shift_update, punch_list.
 *
 * 2026-05-15: appends a Worker World block (supervisor + project + customer +
 * today's JSA + on-file certifications) on ALL flows when the route loads it.
 * Previously, only shift_update saw any JSA data — daily_task and punch_list
 * were blind. Block is suppressed if ctx.opts.workerWorld is missing.
 *
 * Context expected:
 *   {
 *     phase: 'dialogue' | 'finalize' | 'edit',
 *     contextType: 'daily_task' | 'shift_update' | 'punch_list',
 *     opts: {
 *       round, personContext, safetyContext, tradeKnowledge, teamContext,
 *       taskContext, safetyDetection, recentReports,
 *       workerWorld?,           // 2026-05-15
 *     }
 *   }
 */

const { defineAgent } = require('../agentRuntime');
const { buildRefinePrompt } = require('../refinePrompts');
const { formatWorkerWorldBlock } = require('../workerContext');

module.exports = defineAgent({
  name: 'voice.refine.v1',
  // 2026-06-11 (task #45): the refine dialogue is the deepest-reasoning,
  // highest-stakes customer-facing path (trade knowledge + safety reasoning
  // + finalize) and was the only one NOT on Opus while lighter paths
  // (converse, jsaAnalyzer, sparksChat) ran Opus. Requires the
  // 'claude-opus-4-8' MODEL_PRICING entries in agentRuntime.js +
  // anthropicClient.js — without them prefix-match falls through to legacy
  // claude-opus-4 pricing ($15/$75) and the cost guardrail blocks the call.
  model: 'claude-opus-4-8',
  systemPrompt: (ctx) => {
    if (!ctx || !ctx.phase) {
      throw new Error('voiceRefine: context.phase is required (dialogue|finalize|edit)');
    }
    const base = buildRefinePrompt(ctx.phase, ctx.contextType || 'daily_task', ctx.opts || {});
    const block = formatWorkerWorldBlock(ctx.opts && ctx.opts.workerWorld);
    return block ? `${base}\n${block}` : base;
  },
  tools: [],
  jsonMode: true, // structured output per phase — always parse
  mcpServers: [],
  guardrails: {
    // Refine finalize/edit returns JSON payloads that can be sizeable.
    // costLimit 10→20 (task #45): Opus 4.8 estimate for a knowledge-rich
    // dialogue turn is ~9-12c (input ~8-15K tok @ 0.0005 + 2048 out @
    // 0.0025); the old 10c ceiling sat exactly on the estimate and would
    // intermittently block legitimate turns.
    maxTokens: 2048,
    timeoutMs: 45000,
    costLimitPerCallCents: 20,
    blockPII: false,
  },
});
