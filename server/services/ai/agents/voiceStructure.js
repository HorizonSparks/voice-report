/**
 * Voice Structure Agent (voice.structure.v1)
 *
 * Wraps buildStructurePrompt for trade workers and buildSparksStructurePrompt
 * for the Sparks software team. This agent handles the /api/structure route
 * which turns a raw voice transcript into a structured report.
 *
 * 2026-05-15: appends a Worker World block (supervisor + project + customer +
 * today's JSA + on-file certifications) when the route loads it. Block is
 * suppressed if ctx.workerWorld is missing — preserves prior behavior.
 *
 * Context expected:
 *   {
 *     contextPackage: object,   // from buildContextPackage()
 *     safetyBlock: string,      // from buildSafetyBlock()
 *     trade: string,            // for Sparks routing
 *     workerWorld?: object,     // optional, from workerContext.loadWorkerWorld
 *   }
 */

const { defineAgent } = require('../agentRuntime');
const { buildStructurePrompt } = require('../promptBuilder');
const { formatWorkerWorldBlock } = require('../workerContext');

// Note: buildStructurePrompt already routes to buildSparksStructurePrompt internally
// when contextPackage.trade === 'sparks'. Callers should set contextPackage.trade
// so the branching happens in one place.

module.exports = defineAgent({
  name: 'voice.structure.v1',
  model: 'claude-sonnet-4-6',
  systemPrompt: (ctx) => {
    if (!ctx || !ctx.contextPackage) {
      // Null-safe fallback inside buildStructurePrompt
      return buildStructurePrompt(null, null);
    }
    const base = buildStructurePrompt(ctx.contextPackage, ctx.safetyBlock || '');
    const block = formatWorkerWorldBlock(ctx.workerWorld);
    return block ? `${base}\n${block}` : base;
  },
  tools: [],
  jsonMode: true, // {verbatim, structured} — always parse
  mcpServers: [],
  guardrails: {
    maxTokens: 4096,
    timeoutMs: 60000,
    costLimitPerCallCents: 20, // ~1/5¢ input cap + margin
    blockPII: false,
  },
});
