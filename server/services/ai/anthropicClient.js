/**
 * Anthropic Claude API Client
 * Wraps all Claude API calls with consistent error handling, cost tracking,
 * and Prometheus metrics for observability.
 */
const analytics = require('../../../database/analytics');
const { aiLogger } = require('../logger');
const {
  anthropicRequestsTotal,
  anthropicTokensTotal,
  anthropicCostTotal,
  anthropicRequestDuration,
} = require('../metrics');

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
async function callClaude({ systemPrompt, messages, maxTokens = 1000, model, tracking = {}, tools, signal }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const useModel = model || DEFAULT_MODEL;
  const service = tracking.service || 'claude';
  const startTime = Date.now();

  const body = {
    model: useModel,
    max_tokens: maxTokens,
    messages,
  };
  if (systemPrompt) body.system = systemPrompt;
  if (tools && tools.length > 0) body.tools = tools;

  let res;
  try {
    res = await fetch(CLAUDE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (fetchErr) {
    const duration = (Date.now() - startTime) / 1000;
    anthropicRequestsTotal.inc({ service, model: useModel, success: 'false' });
    anthropicRequestDuration.observe({ service, model: useModel }, duration);
    throw fetchErr;
  }

  if (!res.ok) {
    const err = await res.text();
    const duration = (Date.now() - startTime) / 1000;
    anthropicRequestsTotal.inc({ service, model: useModel, success: 'false' });
    anthropicRequestDuration.observe({ service, model: useModel }, duration);
    aiLogger.error({ msg: 'claude_api_error', status: res.status, error: err.substring(0, 500), model: useModel, service });
    throw new Error('Claude API failed: ' + res.status);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  const duration = (Date.now() - startTime) / 1000;

  // Track cost: input * $3/10K + output * $15/10K
  const inputTokens = data.usage?.input_tokens || 0;
  const outputTokens = data.usage?.output_tokens || 0;
  const costCents = Math.round((inputTokens * 3 + outputTokens * 15) / 10000);

  // Prometheus metrics
  anthropicRequestsTotal.inc({ service, model: useModel, success: 'true' });
  anthropicTokensTotal.inc({ model: useModel, direction: 'input' }, inputTokens);
  anthropicTokensTotal.inc({ model: useModel, direction: 'output' }, outputTokens);
  anthropicCostTotal.inc({ service }, costCents / 100);
  anthropicRequestDuration.observe({ service, model: useModel }, duration);

  // Analytics DB tracking (existing + Phase 1 agent fields)
  // Phase 1: explicit forwarding of agent_name and project_id — the ...extras
  // spread would not propagate to the fixed INSERT in analytics.trackAiCost.
  // IMPORTANT: spread trackingExtra FIRST, then set reserved fields AFTER so extras
  // cannot accidentally override analytics integrity (provider, service, success, etc).
  const trackingExtra = tracking.extra || {};
  analytics.trackAiCost({
    ...trackingExtra,
    request_id: tracking.requestId,
    person_id: tracking.personId || null,
    provider: 'anthropic',
    service,
    model: useModel,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    estimated_cost_cents: costCents,
    success: 1,
    agent_name: trackingExtra.agent_name || null,
    project_id: trackingExtra.project_id || 'default',
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
    aiLogger.warn({ msg: 'claude_json_parse_error', preview: result.text.substring(0, 200) });
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
