/**
 * Sparks Chat Agent (voice.sparks.v1)
 *
 * The Sparks command center copilot — the big 18-tool dynamic agent currently
 * embedded inline in server/routes/agent.js. Phase 1 wraps the callClaude
 * invocation in runAgent() without extracting the 18 tool implementations
 * (that's Phase 1.5 work).
 *
 * Uses dynamicTools: true because the tool set is filtered per user role at
 * call time via getToolsForRole() in agent.js.
 *
 * The system prompt is built inline in the route (it's a large block with
 * runtime context like conversation history and knowledge snippets), so this
 * agent accepts a pre-built systemPrompt string via context.systemPrompt.
 *
 * Context expected:
 *   {
 *     systemPrompt: string,     // pre-built in agent.js route handler
 *   }
 *
 * Model can be overridden per-call (Opus for admins, Sonnet fallback after 429)
 * via overrides.model.
 */

const { defineAgent } = require('../agentRuntime');

module.exports = defineAgent({
  name: 'voice.sparks.v1',
  // Default model — the route will override with Opus for admins and
  // fall back to Sonnet on 429.
  model: 'claude-sonnet-4-20250514',
  systemPrompt: (ctx) => {
    if (!ctx || typeof ctx.systemPrompt !== 'string' || ctx.systemPrompt.length === 0) {
      throw new Error(
        'sparksChat: context.systemPrompt is required (route builds it from runtime state)'
      );
    }
    return ctx.systemPrompt;
  },
  tools: [],
  mcpServers: [],
  dynamicTools: true,
  guardrails: {
    maxTokens: 2000,
    timeoutMs: 120000, // chat can run longer for tool loops
    costLimitPerCallCents: 50, // one chat turn, may include tool calls
    blockPII: false,
  },
});
