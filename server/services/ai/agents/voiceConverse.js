/**
 * Voice Converse Agent (voice.converse.v1)
 *
 * Wraps buildConversePrompt for the /api/converse follow-up conversation.
 * buildConversePrompt already handles Sparks trade routing internally, so
 * this agent just delegates.
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
 *   }
 */

const { defineAgent } = require('../agentRuntime');
const { buildConversePrompt } = require('../promptBuilder');

module.exports = defineAgent({
  name: 'voice.converse.v1',
  model: 'claude-sonnet-4-20250514',
  systemPrompt: (ctx) => buildConversePrompt(ctx || {}),
  tools: [],
  mcpServers: [],
  guardrails: {
    maxTokens: 500,
    timeoutMs: 30000,
    costLimitPerCallCents: 5,
    blockPII: false,
  },
});
