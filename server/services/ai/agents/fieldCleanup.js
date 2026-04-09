/**
 * Field Cleanup Agent (voice.fieldCleanup.v1)
 *
 * Small Claude call that cleans up raw spoken text for insertion into a form
 * field. Replaces the inline prompt in anthropicClient.js cleanupFieldText()
 * which becomes a thin wrapper over runAgent(fieldCleanup, ...) in Milestone C.
 *
 * DESIGN NOTE (Codex audit fix):
 *   System prompt contains ONLY the cleanup instruction (either the default or
 *   a per-field customPrompt). The raw spoken text is placed in the USER
 *   message by the caller, NOT interpolated into the system prompt. This keeps
 *   attacker-controllable voice transcripts out of the authoritative slot.
 *
 * Caller responsibility (Milestone C in anthropicClient.js cleanupFieldText):
 *   const fieldCleanup = require('./agents/fieldCleanup');
 *   const result = await runAgent(fieldCleanup, {
 *     context: { customPrompt },   // optional field-specific instruction
 *     messages: [{
 *       role: 'user',
 *       content: fieldCleanup.buildUserContent(text),
 *     }],
 *     tracking: { ... },
 *   });
 */

const { defineAgent } = require('../agentRuntime');

const DEFAULT_CLEANUP_INSTRUCTION =
  'Clean up this spoken text for a professional construction safety/work form. ' +
  'Fix grammar, make it clear and concise, but keep the original meaning and all ' +
  'specific details (names, numbers, locations, equipment). Do NOT add information ' +
  "that wasn't said. Return ONLY the cleaned text, nothing else.";

/**
 * Build the user message content from the raw spoken text.
 */
function buildUserContent(text) {
  if (typeof text !== 'string') {
    throw new Error('fieldCleanup: text must be a string');
  }
  return `Spoken text: "${text}"`;
}

const agent = defineAgent({
  name: 'voice.fieldCleanup.v1',
  model: 'claude-sonnet-4-20250514',
  // systemPrompt is a function so each call can supply its own customPrompt,
  // falling back to the default instruction when none is provided.
  systemPrompt: (ctx) => (ctx && ctx.customPrompt) || DEFAULT_CLEANUP_INSTRUCTION,
  tools: [],
  mcpServers: [],
  guardrails: {
    maxTokens: 500,
    timeoutMs: 20000,
    costLimitPerCallCents: 2,
    blockPII: false,
  },
});

module.exports = Object.freeze({
  ...agent,
  agent,
  buildUserContent,
  DEFAULT_CLEANUP_INSTRUCTION,
});
