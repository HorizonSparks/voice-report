/**
 * JSA Analyzer Agent (voice.jsaMatchCheck.v1)
 *
 * Compares a JSA task description against an assigned work task to determine
 * whether the JSA adequately covers the hazards. Closes the direct-fetch bypass
 * in server/routes/jsa.js (lines 491-519) in Milestone C.
 *
 * DESIGN NOTE (Codex audit fix):
 *   The system prompt is STATIC — it contains only the role and output format
 *   instruction. Variable user data (jsa_task_description, task_title,
 *   task_description) is placed in the USER message by the caller, NOT in the
 *   system prompt. This reduces prompt-injection risk because the model treats
 *   system prompts as more authoritative than user content.
 *
 * Caller responsibility (Milestone C in jsa.js):
 *   const jsaAnalyzer = require('../services/ai/agents/jsaAnalyzer');
 *   const result = await runAgent(jsaAnalyzer, {
 *     messages: [{
 *       role: 'user',
 *       content: jsaAnalyzer.buildUserContent({ jsa_task_description, task_title, task_description }),
 *     }],
 *     tracking: { ... },
 *   });
 *
 * Returns JSON via runAgent's auto-parse because the system prompt ends with
 * "Return ONLY valid JSON (no markdown)".
 */

const { defineAgent } = require('../agentRuntime');

const JSA_SYSTEM_PROMPT =
  'You are a construction safety expert. Compare the JSA (Job Safety Analysis) ' +
  'task description against the assigned work task provided in the user message. ' +
  'Determine if the JSA adequately covers the hazards of the task.\n\n' +
  'Return ONLY valid JSON (no markdown): { "match": boolean, "confidence": "high"|"medium"|"low", "reason": "brief explanation", "missing_hazards": ["hazard1", "hazard2"] }\n' +
  'If the work is substantially the same, match=true. If different work types, ' +
  'locations, or equipment, match=false with missing_hazards.';

/**
 * Build the user message content from the variable JSA inputs.
 * The caller uses this to construct messages for runAgent().
 */
function buildUserContent({ jsa_task_description, task_title, task_description }) {
  if (!jsa_task_description || !task_title) {
    throw new Error('jsaAnalyzer: jsa_task_description and task_title are required');
  }
  const taskDetails = task_description ? `\nTask Details: "${task_description}"` : '';
  return (
    `JSA Task Description: "${jsa_task_description}"\n\n` +
    `Assigned Task: "${task_title}"${taskDetails}`
  );
}

const agent = defineAgent({
  name: 'voice.jsaMatchCheck.v1',
  model: 'claude-sonnet-4-20250514',
  systemPrompt: JSA_SYSTEM_PROMPT,
  tools: [],
  mcpServers: [],
  guardrails: {
    maxTokens: 500,
    timeoutMs: 30000,
    costLimitPerCallCents: 3,
    blockPII: false,
  },
});

// Export a FROZEN container that spreads the agent's properties (so `require(...)`
// can be passed directly to runAgent) and also exports the helper and the static
// prompt. Inner properties like tools/guardrails stay frozen because they're the
// same object references from the original frozen agent.
module.exports = Object.freeze({
  ...agent,
  agent,
  buildUserContent,
  JSA_SYSTEM_PROMPT,
});
