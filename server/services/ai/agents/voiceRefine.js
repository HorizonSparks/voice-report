/**
 * Voice Refine Agent (voice.refine.v1)
 *
 * Wraps buildRefinePrompt which dispatches to buildDialoguePrompt / buildFinalizePrompt /
 * buildEditPrompt based on the refine phase. Used by the /api/refine route for
 * the three refine flows: daily_task, shift_update, punch_list.
 *
 * Context expected:
 *   {
 *     phase: 'dialogue' | 'finalize' | 'edit',
 *     contextType: 'daily_task' | 'shift_update' | 'punch_list',
 *     opts: {
 *       round, personContext, safetyContext, tradeKnowledge, teamContext,
 *       taskContext, safetyDetection, recentReports
 *     }
 *   }
 */

const { defineAgent } = require('../agentRuntime');
const { buildRefinePrompt } = require('../refinePrompts');

module.exports = defineAgent({
  name: 'voice.refine.v1',
  model: 'claude-sonnet-4-20250514',
  systemPrompt: (ctx) => {
    if (!ctx || !ctx.phase) {
      throw new Error('voiceRefine: context.phase is required (dialogue|finalize|edit)');
    }
    return buildRefinePrompt(ctx.phase, ctx.contextType || 'daily_task', ctx.opts || {});
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
