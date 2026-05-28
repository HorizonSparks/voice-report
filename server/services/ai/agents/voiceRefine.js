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
  model: 'claude-sonnet-4-6',
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
    // Refine finalize/edit returns JSON payloads that can be sizeable
    maxTokens: 2048,
    timeoutMs: 45000,
    costLimitPerCallCents: 10,
    blockPII: false,
  },
});
