/**
 * Voice Structure Agent (voice.structure.v1)
 *
 * Wraps buildStructurePrompt for trade workers and buildSparksStructurePrompt
 * for the Sparks software team. This agent handles the /api/structure route
 * which turns a raw voice transcript into a structured report.
 *
 * Context expected:
 *   {
 *     contextPackage: object,   // from buildContextPackage()
 *     safetyBlock: string,      // from buildSafetyBlock()
 *     trade: string,            // for Sparks routing
 *   }
 */

const { defineAgent } = require('../agentRuntime');
const { buildStructurePrompt } = require('../promptBuilder');

// Note: buildStructurePrompt already routes to buildSparksStructurePrompt internally
// when contextPackage.trade === 'sparks'. Callers should set contextPackage.trade
// so the branching happens in one place.

module.exports = defineAgent({
  name: 'voice.structure.v1',
  model: 'claude-sonnet-4-20250514',
  systemPrompt: (ctx) => {
    if (!ctx || !ctx.contextPackage) {
      // Null-safe fallback inside buildStructurePrompt
      return buildStructurePrompt(null, null);
    }
    return buildStructurePrompt(ctx.contextPackage, ctx.safetyBlock || '');
  },
  tools: [],
  mcpServers: [],
  guardrails: {
    maxTokens: 4096,
    timeoutMs: 60000,
    costLimitPerCallCents: 20, // ~1/5¢ input cap + margin
    blockPII: false,
  },
});
