/**
 * Anthropic Claude API Client
 * Wraps all Claude API calls with consistent error handling and cost tracking.
 * Extracted from ai.js for reusability and testability.
 */
const analytics = require('../../../database/analytics');

const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const API_VERSION = '2023-06-01';

/**
 * Call Claude API
 * @param {object} params
 * @param {string} params.systemPrompt - System prompt
 * @param {Array} params.messages - Conversation messages [{role, content}]
 * @param {number} params.maxTokens - Max output tokens (default 1000)
 * @param {string} params.model - Model override (default claude-sonnet)
 * @param {object} params.tracking - { requestId, personId, service } for analytics
 * @returns {{ text: string, usage: object, raw: object }}
 */
async function callClaude({ systemPrompt, messages, maxTokens = 1000, model, tracking = {}, tools }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const useModel = model || DEFAULT_MODEL;

  const body = {
    model: useModel,
    max_tokens: maxTokens,
    messages,
  };
  if (systemPrompt) body.system = systemPrompt;
  if (tools && tools.length > 0) body.tools = tools;

  const res = await fetch(CLAUDE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': API_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Claude API error:', err);
    throw new Error(`Claude API failed: ${res.status}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || '';

  // Track cost: input × $3/10K + output × $15/10K
  const inputTokens = data.usage?.input_tokens || 0;
  const outputTokens = data.usage?.output_tokens || 0;
  const costCents = Math.round((inputTokens * 3 + outputTokens * 15) / 10000);

  analytics.trackAiCost({
    request_id: tracking.requestId,
    person_id: tracking.personId || null,
    provider: 'anthropic',
    service: tracking.service || 'claude',
    model: useModel,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    estimated_cost_cents: costCents,
    success: 1,
    ...(tracking.extra || {}),
  });

  return { text, usage: data.usage, raw: data, content: data.content, stop_reason: data.stop_reason };
}

/**
 * Call Claude and parse JSON response (with regex fallback)
 */
async function callClaudeJSON(params) {
  const result = await callClaude(params);

  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : result.text);
    return { ...result, parsed };
  } catch (parseErr) {
    console.error('Claude JSON parse error:', result.text.substring(0, 200));
    return { ...result, parsed: null, parseError: parseErr.message };
  }
}

/**
 * Simple Claude call for field cleanup (short responses)
 */
async function cleanupFieldText(text, customPrompt, tracking = {}) {
  const prompt = customPrompt
    ? `${customPrompt}\n\nSpoken text: "${text}"`
    : `Clean up this spoken text for a professional construction safety/work form. Fix grammar, make it clear and concise, but keep the original meaning and all specific details (names, numbers, locations, equipment). Do NOT add information that wasn't said. Return ONLY the cleaned text, nothing else.\n\nSpoken text: "${text}"`;

  const result = await callClaude({
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 500,
    tracking: { ...tracking, service: 'field_cleanup' },
  });

  return result.text;
}

module.exports = {
  CLAUDE_URL,
  DEFAULT_MODEL,
  callClaude,
  callClaudeJSON,
  cleanupFieldText,
};
