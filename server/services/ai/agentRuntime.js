/**
 * Agent Runtime — Phase 2
 *
 * Provides `defineAgent()`, `runAgent()`, and `runAgentWithTools()` as a
 * structured layer on top of `anthropicClient.js` `callClaude`.
 *
 * Goals:
 *   1. Structure every Claude call as a reusable agent definition.
 *   2. Track cost / tokens per agent_name + project_id for Stripe billing.
 *   3. Enforce guardrails (max tokens, cost limits, timeouts) before Claude is called.
 *   4. Stay fully backward compatible — `callClaude` remains exported and usable.
 *   5. Support tool-use loops with session-level guardrails (Phase 2).
 *
 * Forward-compatibility: the shape `{ model, systemPrompt, tools, mcpServers, guardrails }`
 * aligns with Anthropic's Claude Agent SDK / Managed Agents expectations, so Phase 3 can
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

const AGENT_NAME_REGEX = /^[a-z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)*\.v\d+$/;
const CLAUDE_MODEL_PREFIX = 'claude-';
const MAX_ALLOWED_TOKENS = 200000;
const MAX_TOOL_ITERATIONS = 10;

// PII regex patterns for observe-only scanning (Phase 1)
const PII_PATTERNS = {
  ssn: /\b\d{3}-\d{2}-\d{4}\b/,
  credit_card: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
};

// ── Model-aware pricing (cents per token) ───────────────────────
// Pricing as of April 2026. Update when models change.
const MODEL_PRICING = {
  // Sonnet 4: $3/$15 per 1M tokens
  'claude-sonnet-4': { input: 0.0003, output: 0.0015 },
  // Opus 4: $15/$75 per 1M tokens
  'claude-opus-4': { input: 0.0015, output: 0.0075 },
  // Haiku 4.5: $0.80/$4 per 1M tokens
  'claude-haiku-4': { input: 0.00008, output: 0.0004 },
};

/**
 * Get pricing for a model. Matches on prefix (e.g. 'claude-opus-4-20250514' → 'claude-opus-4').
 * Falls back to Sonnet pricing if unknown.
 */
function getModelPricing(model) {
  for (const [prefix, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(prefix)) return pricing;
  }
  // Default to Sonnet pricing for unknown models
  return MODEL_PRICING['claude-sonnet-4'];
}

// Legacy constants kept for backward compatibility
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
      `(first segment must start lowercase, dot-separated, ending in .v{N}, e.g. 'voice.jsaMatchCheck.v1')`
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
    jsonMode: config.jsonMode === true, // force JSON auto-parse even if prompt doesn't match detectJsonMode
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
 * Uses model-aware pricing (Phase 2 fix — Codex review).
 */
function estimateCostCents(systemPromptStr, messages, maxTokens, model) {
  const pricing = model ? getModelPricing(model) : MODEL_PRICING['claude-sonnet-4'];

  const systemChars = systemPromptStr.length;
  const messageChars = messages.reduce((sum, m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
    return sum + content.length;
  }, 0);
  const estInputTokens = Math.ceil((systemChars + messageChars) / 4);
  const estOutputTokens = maxTokens;

  const cents = estInputTokens * pricing.input + estOutputTokens * pricing.output;
  return Math.ceil(cents);
}

/**
 * Calculate actual cost from token usage with model-aware pricing.
 */
function calculateActualCost(inputTokens, outputTokens, model) {
  const pricing = model ? getModelPricing(model) : MODEL_PRICING['claude-sonnet-4'];
  return Math.round(inputTokens * pricing.input + outputTokens * pricing.output);
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
 * Run an agent — the primary entry point for all Claude calls.
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
 * @param {string} [opts._resolvedSystemPrompt] - Internal: pre-resolved system prompt (used by runAgentWithTools)
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

  // ── Resolve systemPrompt (skip if pre-resolved by runAgentWithTools) ──
  const systemPromptStr = opts._resolvedSystemPrompt || await resolveSystemPrompt(agent, context);

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
    throw new AgentValidationError(
      `runAgent[${agent.name}]: agent is not dynamicTools; do not supply overrides.tools`
    );
  }

  // ── Guardrail: cost limit (pre-call estimate, model-aware) ──
  if (agent.guardrails.costLimitPerCallCents !== null) {
    const estCents = estimateCostCents(systemPromptStr, messages, maxTokens, model);
    if (estCents > agent.guardrails.costLimitPerCallCents) {
      agentGuardrailViolationsTotal.inc({ agent_name: agent.name, guardrail_type: 'cost_limit' });
      throw new AgentGuardrailError(
        `Agent "${agent.name}" estimated cost ${estCents}\u00A2 exceeds limit ${agent.guardrails.costLimitPerCallCents}\u00A2`,
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
    agentRequestsTotal.inc({ agent_name: agent.name, model, success: 'false' });
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
  const actualCostCents = calculateActualCost(inputTokens, outputTokens, model);

  // ── Metrics: success ──
  agentRequestsTotal.inc({ agent_name: agent.name, model, success: 'true' });
  agentTokensTotal.inc({ agent_name: agent.name, model, direction: 'input' }, inputTokens);
  agentTokensTotal.inc({ agent_name: agent.name, model, direction: 'output' }, outputTokens);
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

  // ── Auto-parse JSON if agent declares jsonMode or prompt content suggests it ──
  let parsed = null;
  let parseError = null;
  if (agent.jsonMode || detectJsonMode(systemPromptStr)) {
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

// ── runAgentWithTools ───────────────────────────────────────────

/**
 * Run an agent with a tool-use loop. Iterates until Claude returns a text
 * response (stop_reason !== 'tool_use') or session-level guardrails fire.
 *
 * Session-level guardrails enforced across ALL iterations:
 *   - Total timeout budget (agent.guardrails.timeoutMs applies to entire session)
 *   - Total cost budget (agent.guardrails.costLimitPerCallCents applies to entire session)
 *   - Iteration cap (MAX_TOOL_ITERATIONS = 10)
 *   - Tool name allowlisting (only agent-defined tools can be called)
 *   - Tool errors returned with is_error: true (not thrown)
 *
 * @param {object} agent - From defineAgent()
 * @param {object} opts
 * @param {Array} opts.messages - Initial messages [{role, content}]
 * @param {object} [opts.context] - Context for systemPrompt function
 * @param {object} [opts.tracking] - Analytics/billing metadata
 * @param {Function} opts.executeTool - async (toolName, toolInput) => string
 * @param {object} [opts.overrides] - Per-call overrides
 * @returns {Promise<object>} Final result with aggregated usage
 */
async function runAgentWithTools(agent, opts = {}) {
  if (!agent || !agent.name) {
    throw new AgentValidationError('runAgentWithTools: first argument must be an agent definition');
  }
  if (typeof opts.executeTool !== 'function') {
    throw new AgentValidationError(
      `runAgentWithTools[${agent.name}]: opts.executeTool must be a function`
    );
  }

  const { context = {}, tracking = {}, overrides = {} } = opts;
  let messages = [...opts.messages];

  // ── Session-level budget tracking ──
  const sessionStart = Date.now();
  const sessionTimeoutMs = agent.guardrails.timeoutMs;
  const sessionCostLimitCents = agent.guardrails.costLimitPerCallCents;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostCents = 0;
  let iterations = 0;

  // ── Resolve system prompt ONCE (not per iteration) ──
  const systemPromptStr = await resolveSystemPrompt(agent, context);

  // ── Build allowed tool name set for allowlisting ──
  const allowedTools = new Set(agent.tools.map(t => t.name));

  // ── Get model for pricing ──
  const model = overrides.model || agent.model;

  let lastResult = null;

  while (iterations < MAX_TOOL_ITERATIONS) {
    // ── Session timeout check (before iteration starts) ──
    const elapsed = Date.now() - sessionStart;
    if (elapsed >= sessionTimeoutMs) {
      aiLogger.warn({
        msg: 'agent_session_timeout',
        agent: agent.name,
        iterations,
        elapsed_ms: elapsed,
        budget_ms: sessionTimeoutMs,
      });
      throw new AgentTimeoutError(
        `Agent "${agent.name}" session exceeded total timeout of ${sessionTimeoutMs}ms ` +
        `after ${iterations} iterations (${elapsed}ms elapsed)`
      );
    }

    // ── Session cost check (>= to prevent exact-budget overshoot) ──
    if (sessionCostLimitCents !== null && totalCostCents >= sessionCostLimitCents) {
      agentGuardrailViolationsTotal.inc({
        agent_name: agent.name,
        guardrail_type: 'session_cost_limit',
      });
      throw new AgentGuardrailError(
        `Agent "${agent.name}" session cost ${totalCostCents}\u00A2 exceeded limit ` +
        `${sessionCostLimitCents}\u00A2 after ${iterations} iterations`,
        'session_cost_limit'
      );
    }

    iterations++;

    // ── Per-iteration timeout: remaining budget (strict — no overshoot) ──
    const remainingMs = sessionTimeoutMs - (Date.now() - sessionStart);
    const iterationTimeoutMs = Math.min(remainingMs, agent.guardrails.timeoutMs);

    // ── Call runAgent with pre-resolved prompt, per-iteration timeout ──
    const iterAgent = Object.freeze({
      ...agent,
      guardrails: Object.freeze({
        ...agent.guardrails,
        timeoutMs: iterationTimeoutMs,
        // Disable per-call cost limit — we enforce at session level
        costLimitPerCallCents: null,
      }),
    });

    const result = await runAgent(iterAgent, {
      messages,
      context,
      tracking,
      overrides,
      _resolvedSystemPrompt: systemPromptStr,
    });

    // ── Accumulate usage ──
    const iterInput = result.usage?.input_tokens || 0;
    const iterOutput = result.usage?.output_tokens || 0;
    totalInputTokens += iterInput;
    totalOutputTokens += iterOutput;
    totalCostCents += calculateActualCost(iterInput, iterOutput, model);

    lastResult = result;

    // ── Done? Claude returned text, not tool calls ──
    if (result.stop_reason !== 'tool_use') {
      break;
    }

    // ── Extract tool calls from response content ──
    const toolCalls = (result.content || []).filter(b => b.type === 'tool_use');
    if (toolCalls.length === 0) {
      // stop_reason was tool_use but no tool_use blocks — shouldn't happen, break
      break;
    }

    // ── Execute tools (with allowlisting and error handling) ──
    const toolResults = [];
    for (const tc of toolCalls) {
      // Tool allowlisting — only agent-defined tools
      if (!allowedTools.has(tc.name)) {
        aiLogger.warn({
          msg: 'agent_tool_not_allowed',
          agent: agent.name,
          tool: tc.name,
          allowed: [...allowedTools],
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: JSON.stringify({ error: 'Tool not allowed: ' + tc.name }),
          is_error: true,
        });
        continue;
      }

      // Execute tool with error handling
      try {
        const toolOutput = await opts.executeTool(tc.name, tc.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput),
        });
      } catch (err) {
        aiLogger.error({
          msg: 'agent_tool_execution_error',
          agent: agent.name,
          tool: tc.name,
          error: err.message,
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: JSON.stringify({ error: 'Tool execution failed: ' + err.message }),
          is_error: true,
        });
      }
    }

    // ── Append assistant response + tool results to conversation ──
    messages.push({ role: 'assistant', content: result.content });
    messages.push({ role: 'user', content: toolResults });
  }

  // ── Iteration exhaustion ──
  if (iterations >= MAX_TOOL_ITERATIONS && lastResult?.stop_reason === 'tool_use') {
    aiLogger.warn({
      msg: 'agent_max_iterations',
      agent: agent.name,
      iterations,
      total_cost_cents: totalCostCents,
    });
    // Don't throw — return whatever the last response was. The agent may have
    // useful partial analysis. The caller can check iterations in the result.
  }

  // ── Log session summary ──
  const sessionDurationMs = Date.now() - sessionStart;
  aiLogger.info({
    msg: 'agent_tool_session_complete',
    agent: agent.name,
    model,
    iterations,
    total_input_tokens: totalInputTokens,
    total_output_tokens: totalOutputTokens,
    total_cost_cents: totalCostCents,
    duration_ms: sessionDurationMs,
  });

  // ── Return final result with session-level aggregates ──
  return {
    text: lastResult?.text || '',
    parsed: lastResult?.parsed || null,
    parseError: lastResult?.parseError || null,
    usage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
    },
    raw: lastResult?.raw,
    content: lastResult?.content,
    stop_reason: lastResult?.stop_reason,
    agent: {
      name: agent.name,
      model,
      durationMs: sessionDurationMs,
      costCents: totalCostCents,
      iterations,
    },
  };
}

module.exports = {
  defineAgent,
  runAgent,
  runAgentWithTools,
  AgentValidationError,
  AgentGuardrailError,
  AgentTimeoutError,
  // Exported for tests
  _internal: {
    estimateCostCents,
    calculateActualCost,
    getModelPricing,
    scanPII,
    detectJsonMode,
    tryParseJson,
    resolveSystemPrompt,
    AGENT_NAME_REGEX,
    MAX_TOOL_ITERATIONS,
    MODEL_PRICING,
  },
};
