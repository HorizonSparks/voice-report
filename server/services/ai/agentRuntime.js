/**
 * Agent Runtime — Phase 1
 *
 * Provides `defineAgent()` and `runAgent()` as a thin layer on top of
 * the existing `anthropicClient.js` `callClaude` function.
 *
 * Goals:
 *   1. Structure every Claude call as a reusable agent definition.
 *   2. Track cost / tokens per agent_name + project_id for Stripe billing.
 *   3. Enforce guardrails (max tokens, cost limits, timeouts) before Claude is called.
 *   4. Stay fully backward compatible — `callClaude` remains exported and usable.
 *
 * Forward-compatibility: the shape `{ model, systemPrompt, tools, mcpServers, guardrails }`
 * aligns with Anthropic's Claude Agent SDK / Managed Agents expectations, so Phase 2 can
 * swap the runtime internals without touching any route.
 */

const { callClaude } = require('./anthropicClient');
const { aiLogger } = require('../logger');
const {
  agentRequestsTotal,
  agentTokensTotal,
  agentCostTotalCents,
  agentGuardrailViolationsTotal,
  agentCostOverrunsTotal,
} = require('../metrics');

// ── Error classes ───────────────────────────────────────────────

class AgentValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AgentValidationError';
  }
}

class AgentGuardrailError extends Error {
  constructor(message, guardrailType) {
    super(message);
    this.name = 'AgentGuardrailError';
    this.guardrailType = guardrailType;
  }
}

class AgentTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AgentTimeoutError';
  }
}

// ── Constants ───────────────────────────────────────────────────

const AGENT_NAME_REGEX = /^[a-z][a-z0-9]*(\.[a-z0-9]+)*\.v\d+$/;
const CLAUDE_MODEL_PREFIX = 'claude-';
const MAX_ALLOWED_TOKENS = 200000;

// PII regex patterns for observe-only scanning (Phase 1)
const PII_PATTERNS = {
  ssn: /\b\d{3}-\d{2}-\d{4}\b/,
  credit_card: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
};

// Claude pricing (cents per token, ×10000 for integer math)
// sonnet-4: $3 / $15 per 1M tokens → 0.0003 / 0.0015 cents per token
const CLAUDE_INPUT_CENTS_PER_TOKEN = 0.0003;
const CLAUDE_OUTPUT_CENTS_PER_TOKEN = 0.0015;

// ── defineAgent ─────────────────────────────────────────────────

/**
 * Defines an agent and returns a frozen, immutable configuration.
 *
 * @param {object} config
 * @param {string} config.name - Unique name, format: `namespace.role.v1` (e.g. 'voice.structure.v1')
 * @param {string} config.model - Claude model id, must start with 'claude-'
 * @param {string|Function} config.systemPrompt - Static string or function (context) => string (sync or async)
 * @param {Array} [config.tools=[]] - Array of Claude tool schemas
 * @param {Array} [config.mcpServers=[]] - Placeholder for Phase 2, ignored in Phase 1
 * @param {boolean} [config.dynamicTools=false] - If true, tools are required via overrides.tools at call time
 * @param {object} [config.guardrails] - Guardrail configuration
 * @param {boolean} [config.guardrails.enabled=true] - Master switch. Set false for stubs.
 * @param {number} [config.guardrails.maxTokens=1000] - Hard cap on output tokens, 1..200000
 * @param {number} [config.guardrails.timeoutMs=30000] - Abort if response exceeds this
 * @param {number|null} [config.guardrails.costLimitPerCallCents=null] - Estimate-before-call cost gate
 * @param {boolean} [config.guardrails.blockPII=false] - Observe-only regex scan in Phase 1
 * @returns {object} frozen agent definition
 */
function defineAgent(config) {
  if (!config || typeof config !== 'object') {
    throw new AgentValidationError('defineAgent: config must be an object');
  }
  if (!config.name || typeof config.name !== 'string') {
    throw new AgentValidationError('defineAgent: name is required and must be a string');
  }
  if (!AGENT_NAME_REGEX.test(config.name)) {
    throw new AgentValidationError(
      `defineAgent: name "${config.name}" does not match required format ` +
      `(lowercase, dot-separated, ending in .v{N}, e.g. 'voice.structure.v1')`
    );
  }
  if (!config.model || typeof config.model !== 'string') {
    throw new AgentValidationError(`defineAgent[${config.name}]: model is required and must be a string`);
  }
  if (!config.model.startsWith(CLAUDE_MODEL_PREFIX)) {
    throw new AgentValidationError(
      `defineAgent[${config.name}]: model "${config.model}" must start with "${CLAUDE_MODEL_PREFIX}"`
    );
  }
  if (config.systemPrompt === undefined || config.systemPrompt === null) {
    throw new AgentValidationError(`defineAgent[${config.name}]: systemPrompt is required`);
  }
  if (typeof config.systemPrompt !== 'string' && typeof config.systemPrompt !== 'function') {
    throw new AgentValidationError(
      `defineAgent[${config.name}]: systemPrompt must be a string or function`
    );
  }

  const tools = Array.isArray(config.tools) ? config.tools : [];
  for (let i = 0; i < tools.length; i++) {
    const t = tools[i];
    if (!t || typeof t !== 'object' || !t.name || !t.description || !t.input_schema) {
      throw new AgentValidationError(
        `defineAgent[${config.name}]: tool at index ${i} missing required fields {name, description, input_schema}`
      );
    }
  }

  const mcpServers = Array.isArray(config.mcpServers) ? config.mcpServers : [];

  const g = config.guardrails || {};
  const guardrails = {
    enabled: g.enabled !== false, // default true
    maxTokens: typeof g.maxTokens === 'number' ? g.maxTokens : 1000,
    timeoutMs: typeof g.timeoutMs === 'number' ? g.timeoutMs : 30000,
    costLimitPerCallCents:
      typeof g.costLimitPerCallCents === 'number' ? g.costLimitPerCallCents : null,
    blockPII: g.blockPII === true, // default false
  };

  if (guardrails.maxTokens < 1 || guardrails.maxTokens > MAX_ALLOWED_TOKENS) {
    throw new AgentValidationError(
      `defineAgent[${config.name}]: guardrails.maxTokens must be in [1, ${MAX_ALLOWED_TOKENS}], got ${guardrails.maxTokens}`
    );
  }

  // Deep-freeze each tool and mcpServer entry to prevent runtime mutation of agent definitions
  const frozenTools = Object.freeze(tools.map(t => Object.freeze({ ...t })));
  const frozenServers = Object.freeze(mcpServers.map(s => Object.freeze({ ...s })));

  const frozen = Object.freeze({
    name: config.name,
    model: config.model,
    systemPrompt: config.systemPrompt,
    tools: frozenTools,
    mcpServers: frozenServers,
    dynamicTools: config.dynamicTools === true,
    guardrails: Object.freeze(guardrails),
  });

  return frozen;
}

// ── runAgent ─────────────────────────────────────────────────────

/**
 * Resolves systemPrompt value — handles string, sync function, async function.
 */
async function resolveSystemPrompt(agent, context) {
  const sp = agent.systemPrompt;
  if (typeof sp === 'string') return sp;
  if (typeof sp === 'function') {
    const result = await sp(context || {});
    if (typeof result !== 'string' || result.length === 0) {
      throw new AgentValidationError(
        `runAgent[${agent.name}]: systemPrompt function returned empty or non-string value`
      );
    }
    return result;
  }
  throw new AgentValidationError(`runAgent[${agent.name}]: invalid systemPrompt type`);
}

/**
 * Estimate cost in cents BEFORE calling Claude.
 * Used by the costLimitPerCallCents guardrail as a pre-call gate.
 */
function estimateCostCents(systemPromptStr, messages, maxTokens) {
  // Input: rough char → token ratio (~4 chars per token)
  const systemChars = systemPromptStr.length;
  const messageChars = messages.reduce((sum, m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
    return sum + content.length;
  }, 0);
  const estInputTokens = Math.ceil((systemChars + messageChars) / 4);
  const estOutputTokens = maxTokens;

  const cents =
    estInputTokens * CLAUDE_INPUT_CENTS_PER_TOKEN +
    estOutputTokens * CLAUDE_OUTPUT_CENTS_PER_TOKEN;
  return Math.ceil(cents);
}

/**
 * Scan messages for PII patterns (observe-only in Phase 1).
 * Returns array of matched pattern names.
 */
function scanPII(messages) {
  const matches = [];
  const text = messages
    .map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')))
    .join('\n');
  for (const [name, regex] of Object.entries(PII_PATTERNS)) {
    if (regex.test(text)) matches.push(name);
  }
  return matches;
}

/**
 * Attempt to auto-detect JSON mode from system prompt.
 * Matches common patterns like "return only valid JSON", "respond in JSON", etc.
 */
function detectJsonMode(systemPromptStr) {
  if (!systemPromptStr) return false;
  return /return\s+only\s+valid\s+json|respond\s+in\s+json|return\s+only\s+json|return\s+.{0,20}json\s*\(no\s+markdown\)/i.test(
    systemPromptStr
  );
}

/**
 * Parse JSON from Claude text response with a permissive extraction fallback.
 */
function tryParseJson(text) {
  try {
    return { parsed: JSON.parse(text), parseError: null };
  } catch (e1) {
    // Strip markdown fences if present
    const cleaned = text.replace(/```json?\n?/gi, '').replace(/```/g, '').trim();
    try {
      return { parsed: JSON.parse(cleaned), parseError: null };
    } catch (e2) {
      // Permissive: extract first {...} block
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return { parsed: JSON.parse(match[0]), parseError: null };
        } catch (e3) {
          return { parsed: null, parseError: e3.message };
        }
      }
      return { parsed: null, parseError: e2.message };
    }
  }
}

/**
 * Run an agent — the primary entry point for all Claude calls in Phase 1+.
 *
 * @param {object} agent - From defineAgent()
 * @param {object} opts
 * @param {Array} opts.messages - Claude messages array [{role, content}]
 * @param {object} [opts.context] - Context passed to systemPrompt function
 * @param {object} [opts.tracking] - Analytics/billing metadata
 * @param {string} [opts.tracking.requestId] - Correlation id
 * @param {string} [opts.tracking.personId] - Person id for per-user attribution
 * @param {string} [opts.tracking.projectId] - Project id for Stripe billing attribution
 * @param {string} [opts.tracking.companyId] - Company id
 * @param {string} [opts.tracking.service] - Legacy service label
 * @param {object} [opts.overrides] - Per-call overrides
 * @param {string} [opts.overrides.model] - Override model (e.g. Opus→Sonnet fallback)
 * @param {number} [opts.overrides.maxTokens] - Override max tokens (clamped by guardrails)
 * @param {Array} [opts.overrides.tools] - Required if agent.dynamicTools === true
 * @returns {Promise<object>} { text, parsed, parseError, usage, raw, content, stop_reason, agent: {name, model, durationMs, costCents} }
 */
async function runAgent(agent, opts = {}) {
  if (!agent || !agent.name) {
    throw new AgentValidationError('runAgent: first argument must be an agent definition');
  }
  const { messages = [], context = {}, tracking = {}, overrides = {} } = opts;
  if (!Array.isArray(messages)) {
    throw new AgentValidationError(`runAgent[${agent.name}]: opts.messages must be an array`);
  }

  const startTime = Date.now();

  // ── Guardrail: enabled ──
  if (!agent.guardrails.enabled) {
    agentGuardrailViolationsTotal.inc({ agent_name: agent.name, guardrail_type: 'disabled' });
    throw new AgentGuardrailError(`Agent "${agent.name}" is disabled (guardrails.enabled=false)`, 'disabled');
  }

  // ── Resolve systemPrompt ──
  const systemPromptStr = await resolveSystemPrompt(agent, context);

  // ── Resolve model (override allowed) ──
  const model = overrides.model || agent.model;

  // ── Resolve maxTokens (clamp to agent cap and global cap) ──
  const requestedMax =
    typeof overrides.maxTokens === 'number' ? overrides.maxTokens : agent.guardrails.maxTokens;
  if (!Number.isFinite(requestedMax) || !Number.isInteger(requestedMax) || requestedMax < 1) {
    throw new AgentValidationError(
      `runAgent[${agent.name}]: overrides.maxTokens must be a finite integer >= 1, got ${requestedMax}`
    );
  }
  const maxTokens = Math.min(requestedMax, agent.guardrails.maxTokens, MAX_ALLOWED_TOKENS);

  // ── Resolve tools ──
  let tools = agent.tools;
  if (agent.dynamicTools) {
    if (!overrides.tools || !Array.isArray(overrides.tools)) {
      throw new AgentValidationError(
        `runAgent[${agent.name}]: dynamicTools=true requires overrides.tools to be an array`
      );
    }
    tools = overrides.tools;
  } else if (overrides.tools) {
    // Agent is not dynamic but caller supplied tools — reject to avoid confusion
    throw new AgentValidationError(
      `runAgent[${agent.name}]: agent is not dynamicTools; do not supply overrides.tools`
    );
  }

  // ── Guardrail: cost limit (pre-call estimate) ──
  if (agent.guardrails.costLimitPerCallCents !== null) {
    const estCents = estimateCostCents(systemPromptStr, messages, maxTokens);
    if (estCents > agent.guardrails.costLimitPerCallCents) {
      agentGuardrailViolationsTotal.inc({ agent_name: agent.name, guardrail_type: 'cost_limit' });
      throw new AgentGuardrailError(
        `Agent "${agent.name}" estimated cost ${estCents}¢ exceeds limit ${agent.guardrails.costLimitPerCallCents}¢`,
        'cost_limit'
      );
    }
  }

  // ── Guardrail: PII scan (observe-only) ──
  if (agent.guardrails.blockPII) {
    const matches = scanPII(messages);
    if (matches.length > 0) {
      aiLogger.warn({
        msg: 'pii_detected',
        agent: agent.name,
        match_types: matches,
        phase: 'observe_only',
      });
      agentGuardrailViolationsTotal.inc({ agent_name: agent.name, guardrail_type: 'pii_observed' });
      // Do NOT throw — Phase 1 is observe-only
    }
  }

  // ── Timeout via AbortController ──
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => {
    abortController.abort();
  }, agent.guardrails.timeoutMs);

  // ── Call Claude via existing client ──
  let result;
  try {
    result = await callClaude({
      systemPrompt: systemPromptStr,
      messages,
      maxTokens,
      model,
      tools: tools.length > 0 ? tools : undefined,
      tracking: {
        requestId: tracking.requestId,
        personId: tracking.personId,
        service: tracking.service || agent.name,
        extra: {
          agent_name: agent.name,
          project_id: tracking.projectId || 'default',
        },
      },
      signal: abortController.signal,
    });
  } catch (err) {
    clearTimeout(timeoutHandle);
    // Count failure on agent-scoped metric
    agentRequestsTotal.inc({ agent_name: agent.name, model, success: 'false' });
    // Detect abort → timeout error
    if (err.name === 'AbortError' || /aborted/i.test(err.message || '')) {
      throw new AgentTimeoutError(
        `Agent "${agent.name}" exceeded timeout of ${agent.guardrails.timeoutMs}ms`
      );
    }
    throw err;
  }
  clearTimeout(timeoutHandle);

  const durationMs = Date.now() - startTime;
  const inputTokens = result.usage?.input_tokens || 0;
  const outputTokens = result.usage?.output_tokens || 0;
  const actualCostCents = Math.round(
    inputTokens * CLAUDE_INPUT_CENTS_PER_TOKEN + outputTokens * CLAUDE_OUTPUT_CENTS_PER_TOKEN
  );

  // ── Metrics: success ──
  agentRequestsTotal.inc({ agent_name: agent.name, model, success: 'true' });
  agentTokensTotal.inc({ agent_name: agent.name, model, direction: 'input' }, inputTokens);
  agentTokensTotal.inc({ agent_name: agent.name, model, direction: 'output' }, outputTokens);
  // Prometheus label is agent_name only — project_id would be unbounded cardinality.
  // Per-project attribution for billing lives in the analytics_ai_costs DB row.
  agentCostTotalCents.inc({ agent_name: agent.name }, actualCostCents);

  // ── Post-call guardrail: cost overrun observation ──
  if (
    agent.guardrails.costLimitPerCallCents !== null &&
    actualCostCents > agent.guardrails.costLimitPerCallCents * 2
  ) {
    agentCostOverrunsTotal.inc({ agent_name: agent.name });
    aiLogger.warn({
      msg: 'agent_cost_overrun',
      agent: agent.name,
      limit_cents: agent.guardrails.costLimitPerCallCents,
      actual_cents: actualCostCents,
    });
  }

  // ── Auto-parse JSON if detected ──
  let parsed = null;
  let parseError = null;
  if (detectJsonMode(systemPromptStr)) {
    const parseResult = tryParseJson(result.text || '');
    parsed = parseResult.parsed;
    parseError = parseResult.parseError;
  }

  // ── Return superset of callClaude's shape ──
  return {
    text: result.text,
    parsed,
    parseError,
    usage: result.usage,
    raw: result.raw,
    content: result.content,
    stop_reason: result.stop_reason,
    agent: {
      name: agent.name,
      model,
      durationMs,
      costCents: actualCostCents,
    },
  };
}

module.exports = {
  defineAgent,
  runAgent,
  AgentValidationError,
  AgentGuardrailError,
  AgentTimeoutError,
  // Exported for tests
  _internal: {
    estimateCostCents,
    scanPII,
    detectJsonMode,
    tryParseJson,
    resolveSystemPrompt,
    AGENT_NAME_REGEX,
  },
};
