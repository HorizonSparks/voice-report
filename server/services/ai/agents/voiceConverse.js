/**
 * Voice Converse Agent (voice.converse.v1)
 *
 * Wraps buildConversePrompt for the /api/converse follow-up conversation.
 * buildConversePrompt already handles Sparks trade routing internally, so
 * this agent just delegates.
 *
 * 2026-05-15: appends a Worker World block (supervisor + project + customer +
 * today's JSA + on-file certifications) when the route loads it. Block is
 * suppressed when ctx.workerWorld is missing — preserves prior behavior.
 *
 * Context expected:
 *   {
 *     personName: string,
 *     roleTitle: string,
 *     roleDescription: string,
 *     reportFocus: string,
 *     outputSections: string[],
 *     messagesForPerson: [{from, text}],
 *     trade: string,
 *     workerWorld?: object,   // optional, from workerContext.loadWorkerWorld
 *   }
 */

const { defineAgent } = require('../agentRuntime');
const { buildConversePrompt } = require('../promptBuilder');
const { formatWorkerWorldBlock } = require('../workerContext');

module.exports = defineAgent({
  name: 'voice.converse.v1',
  model: 'claude-opus-4-7',
  systemPrompt: (ctx) => {
    const base = buildConversePrompt(ctx || {});
    const block = formatWorkerWorldBlock(ctx && ctx.workerWorld);
    return block ? `${base}\n${block}` : base;
  },
  tools: [],
  mcpServers: [],
  guardrails: {
    maxTokens: 500,
    timeoutMs: 30000,
    costLimitPerCallCents: 5,
    blockPII: false,
  },
});
