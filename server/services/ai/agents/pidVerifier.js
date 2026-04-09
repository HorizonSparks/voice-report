/**
 * P&ID Verifier Agent (loopfolders.pidVerifier.v1) — Phase 2 STUB
 *
 * Placeholder agent definition for the future P&ID verification agent that
 * will compare YOLO-extracted tags against Excel structured data, detect fuzzy
 * matches (FIT-2301 vs FI-2301), orphan tags, and naming convention breaks.
 *
 * This stub is intentionally gated with `guardrails.enabled: false` so any
 * accidental call throws an AgentGuardrailError instead of making a real
 * Claude request. The shape is correct so Phase 2 only needs to fill in the
 * prompt and flip `enabled` to true.
 *
 * Do NOT remove this stub. Its existence documents the Phase 2 intent and
 * allows routes to import and reference the eventual agent name.
 */

const { defineAgent } = require('../agentRuntime');

module.exports = defineAgent({
  name: 'loopfolders.pidVerifier.v1',
  model: 'claude-sonnet-4-20250514',
  systemPrompt:
    '[PHASE 2 STUB] You are a P&ID verification agent. This stub is gated and ' +
    'should never be called. See plan: agent-runtime-phase1 for the rollout schedule.',
  tools: [],
  mcpServers: [],
  guardrails: {
    enabled: false, // MUST stay false until Phase 2 lands
    maxTokens: 4096,
    timeoutMs: 60000,
    costLimitPerCallCents: 100,
    blockPII: false,
  },
});
