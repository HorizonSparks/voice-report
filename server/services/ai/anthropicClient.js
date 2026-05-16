/**
 * Anthropic Claude API Client
 *
 * 2026-05-15 update — fixes:
 *   1. Per-model cost tracking (was hardcoded to Sonnet pricing — Opus was 5x undercount)
 *   2. Prompt caching via cache_control on system prompts > 4096 chars
 *      (uses anthropic-beta: prompt-caching-2024-07-31 header)
 *   3. 429-aware retry with exponential backoff + Retry-After respect
 *   4. Tracks cache_creation/cache_read input tokens separately
 *
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
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const API_VERSION = '2023-06-01';
const PROMPT_CACHE_BETA = 'prompt-caching-2024-07-31';
const SYSTEM_CACHE_THRESHOLD = 4096;   // chars; cache only when system prompt is large enough to matter
const MAX_RETRIES = 3;                 // total attempts on 429/529/5xx (incl. first try)

// ── Per-model pricing (cents per token) ─────────────────────────
// Source: https://docs.anthropic.com/en/docs/about-claude/pricing (verified 2026-05-15).
// Order matters: more-specific prefixes go FIRST so prefix-match resolves them
// before the family default. Object.entries preserves insertion order in V8.
// Cache discount: cache_read = 10% of normal input, cache_creation = 125%.
const MODEL_PRICING = {
  // Opus 4.5+ (newer cheaper tier — $5 / $25 per Mtok)
  'claude-opus-4-7': { input: 0.0005,  output: 0.0025  },
  'claude-opus-4-6': { input: 0.0005,  output: 0.0025  },
  'claude-opus-4-5': { input: 0.0005,  output: 0.0025  },
  // Legacy Opus 4 / 4.1 (deprecated — $15 / $75 per Mtok). Default for any
  // unknown claude-opus-4-* prefix that isn't 4.5+ above.
  'claude-opus-4':   { input: 0.0015,  output: 0.0075  },
  // Sonnet — all 4.x at $3 / $15 per Mtok
  'claude-sonnet-4': { input: 0.0003,  output: 0.0015  },
  // Haiku 4.5 ($1 / $5 per Mtok). NOTE: different from retired Haiku 3.5 ($0.80 / $4).
  'claude-haiku-4':  { input: 0.0001,  output: 0.0005  },
};

function getModelPricing(model) {
  for (const [prefix, p] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(prefix)) return p;
  }
  // Unknown model — default to Sonnet pricing rather than 0 so we never report "free."
  return MODEL_PRICING['claude-sonnet-4'];
}

function computeCostCents(model, usage) {
  const p = getModelPricing(model);
  const inputTokens = usage?.input_tokens || 0;
  const outputTokens = usage?.output_tokens || 0;
  const cacheRead = usage?.cache_read_input_tokens || 0;
  const cacheCreation = usage?.cache_creation_input_tokens || 0;
  // Standard input + output, plus cache surcharge/discount.
  const cents =
    inputTokens * p.input +
    outputTokens * p.output +
    cacheRead * p.input * 0.10 +       // cached read = 10% of normal input
    cacheCreation * p.input * 1.25;    // cache write = 25% premium over normal input
  return Math.round(cents);
}

// ── 429 / 529 / 5xx retry with exponential backoff ─────────────
function isTransientStatus(status) {
  return status === 429 || status === 529 || (status >= 500 && status < 600);
}

function backoffMs(attempt, retryAfterHeader) {
  if (retryAfterHeader) {
    const seconds = parseInt(retryAfterHeader, 10);
    if (!Number.isNaN(seconds) && seconds > 0 && seconds <= 60) return seconds * 1000;
  }
  return Math.min(8000, 1000 * Math.pow(2, attempt - 1)); // 1s → 2s → 4s, cap 8s
}

// ── Build request body, applying prompt caching when worth it ──
function buildRequestBody({ model, maxTokens, systemPrompt, messages, tools }) {
  const body = { model, max_tokens: maxTokens, messages };
  if (systemPrompt) {
    if (typeof systemPrompt === 'string' && systemPrompt.length >= SYSTEM_CACHE_THRESHOLD) {
      // Convert long system prompts to an array block with cache_control so the
      // identical prompt is billed at 10% on subsequent calls within the 5-min TTL.
      body.system = [
        { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
      ];
    } else {
      body.system = systemPrompt; // small or already-shaped — leave untouched
    }
  }
  if (tools && tools.length > 0) body.tools = tools;
  return body;
}

function shouldRequestCacheBeta(body) {
  // Beta header only needed if anything in the body uses cache_control.
  if (Array.isArray(body.system)) {
    return body.system.some(b => b && b.cache_control);
  }
  if (Array.isArray(body.tools)) {
    return body.tools.some(t => t && t.cache_control);
  }
  return false;
}

/**
 * Call Claude API
 * @param {object} params
 * @param {string} params.systemPrompt - System prompt (string; auto-cached when > 4KB)
 * @param {Array}  params.messages     - [{role, content}]
 * @param {number} params.maxTokens    - default 1000
 * @param {string} params.model        - override DEFAULT_MODEL
 * @param {object} params.tracking     - { requestId, personId, service, extra } for analytics
 * @param {Array}  params.tools        - tool defs (cache_control supported on entries)
 * @param {AbortSignal} params.signal
 * @returns {{ text, usage, raw, content, stop_reason }}
 */
async function callClaude({ systemPrompt, messages, maxTokens = 1000, model, tracking = {}, tools, signal }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const useModel = model || DEFAULT_MODEL;
  const service = tracking.service || 'claude';
  const startTime = Date.now();

  const body = buildRequestBody({ model: useModel, maxTokens, systemPrompt, messages, tools });
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': process.env.ANTHROPIC_API_KEY,
    'anthropic-version': API_VERSION,
  };
  if (shouldRequestCacheBeta(body)) {
    headers['anthropic-beta'] = PROMPT_CACHE_BETA;
  }

  let res;
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      res = await fetch(CLAUDE_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (fetchErr) {
      // Deliberate cancellation (signal aborted, AbortError) — never retry.
      // Otherwise a cancelled request keeps occupying the route handler for ~3s
      // of backoff sleep before failing. Rethrow immediately.
      if (fetchErr && (fetchErr.name === 'AbortError' || (signal && signal.aborted))) {
        const duration = (Date.now() - startTime) / 1000;
        anthropicRequestsTotal.inc({ service, model: useModel, success: 'false' });
        anthropicRequestDuration.observe({ service, model: useModel }, duration);
        throw fetchErr;
      }
      // Network-level failure (DNS, connection reset, etc.) — retry like 5xx.
      lastError = fetchErr;
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, backoffMs(attempt)));
        continue;
      }
      const duration = (Date.now() - startTime) / 1000;
      anthropicRequestsTotal.inc({ service, model: useModel, success: 'false' });
      anthropicRequestDuration.observe({ service, model: useModel }, duration);
      throw fetchErr;
    }

    if (res.ok) break;

    if (isTransientStatus(res.status) && attempt < MAX_RETRIES) {
      const retryAfter = res.headers.get('retry-after');
      const wait = backoffMs(attempt, retryAfter);
      aiLogger.warn({ msg: 'claude_retry', status: res.status, attempt, wait_ms: wait, model: useModel, service });
      // drain body so the connection is reusable
      await res.text().catch(() => {});
      await new Promise(r => setTimeout(r, wait));
      continue;
    }

    // Non-retriable or attempts exhausted.
    const err = await res.text();
    const duration = (Date.now() - startTime) / 1000;
    anthropicRequestsTotal.inc({ service, model: useModel, success: 'false' });
    anthropicRequestDuration.observe({ service, model: useModel }, duration);
    aiLogger.error({ msg: 'claude_api_error', status: res.status, error: err.substring(0, 500), model: useModel, service, attempts: attempt });
    throw new Error('Claude API failed: ' + res.status);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  const duration = (Date.now() - startTime) / 1000;

  // Per-model cost (now correct for Opus / Sonnet / Haiku) + cache token surcharge/discount.
  const usage = data.usage || {};
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheCreation = usage.cache_creation_input_tokens || 0;
  const costCents = computeCostCents(useModel, usage);

  // Prometheus metrics
  anthropicRequestsTotal.inc({ service, model: useModel, success: 'true' });
  anthropicTokensTotal.inc({ model: useModel, direction: 'input' }, inputTokens);
  anthropicTokensTotal.inc({ model: useModel, direction: 'output' }, outputTokens);
  if (cacheRead) anthropicTokensTotal.inc({ model: useModel, direction: 'cache_read' }, cacheRead);
  if (cacheCreation) anthropicTokensTotal.inc({ model: useModel, direction: 'cache_creation' }, cacheCreation);
  anthropicCostTotal.inc({ service }, costCents / 100);
  anthropicRequestDuration.observe({ service, model: useModel }, duration);

  // Analytics DB tracking — keep schema-stable; spread extras first so reserved fields win.
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

  return { text, usage, raw: data, content: data.content, stop_reason: data.stop_reason };
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
 * Simple Claude call for field cleanup (short responses).
 * Routed through agentRuntime so it gets the same metrics + guardrails.
 */
async function cleanupFieldText(text, customPrompt, tracking = {}) {
  const { runAgent } = require('./agentRuntime'); // lazy — avoid circular dep
  const fieldCleanup = require('./agents/fieldCleanup');

  const result = await runAgent(fieldCleanup, {
    context: { customPrompt },
    messages: [{ role: 'user', content: fieldCleanup.buildUserContent(text) }],
    tracking: { ...tracking, service: 'field_cleanup' },
  });

  return result.text;
}

module.exports = {
  CLAUDE_URL,
  DEFAULT_MODEL,
  MODEL_PRICING,
  getModelPricing,
  computeCostCents,
  callClaude,
  callClaudeJSON,
  cleanupFieldText,
};
