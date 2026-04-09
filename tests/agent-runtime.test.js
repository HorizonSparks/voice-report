/**
 * Agent Runtime Tests — Phase 1 Milestone A
 *
 * Exercises defineAgent() + runAgent() in isolation with a mocked callClaude.
 * Covers validation, guardrails, tracking forwarding, JSON auto-parse, and
 * the bypass-regression grep checks.
 */

describe('Agent Runtime — defineAgent', () => {
  let defineAgent, AgentValidationError;

  beforeAll(() => {
    ({ defineAgent, AgentValidationError } = require('../server/services/ai/agentRuntime'));
  });

  describe('happy path', () => {
    test('returns a frozen agent with defaults applied', () => {
      const agent = defineAgent({
        name: 'test.basic.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'You are a test agent.',
      });
      expect(Object.isFrozen(agent)).toBe(true);
      expect(Object.isFrozen(agent.tools)).toBe(true);
      expect(Object.isFrozen(agent.guardrails)).toBe(true);
      expect(agent.name).toBe('test.basic.v1');
      expect(agent.tools).toEqual([]);
      expect(agent.mcpServers).toEqual([]);
      expect(agent.dynamicTools).toBe(false);
      expect(agent.guardrails.enabled).toBe(true);
      expect(agent.guardrails.maxTokens).toBe(1000);
      expect(agent.guardrails.timeoutMs).toBe(30000);
      expect(agent.guardrails.costLimitPerCallCents).toBe(null);
      expect(agent.guardrails.blockPII).toBe(false);
    });

    test('accepts function systemPrompt', () => {
      const fn = (ctx) => `Hello ${ctx.name}`;
      const agent = defineAgent({
        name: 'test.fn.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: fn,
      });
      expect(agent.systemPrompt).toBe(fn);
    });

    test('accepts tools with proper schema', () => {
      const agent = defineAgent({
        name: 'test.tools.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'x',
        tools: [
          { name: 'foo', description: 'does foo', input_schema: { type: 'object', properties: {} } },
        ],
      });
      expect(agent.tools.length).toBe(1);
    });

    test('accepts dynamicTools flag', () => {
      const agent = defineAgent({
        name: 'test.dyn.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'x',
        dynamicTools: true,
      });
      expect(agent.dynamicTools).toBe(true);
    });

    test('accepts guardrails overrides', () => {
      const agent = defineAgent({
        name: 'test.guards.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'x',
        guardrails: {
          enabled: true,
          maxTokens: 4096,
          timeoutMs: 60000,
          costLimitPerCallCents: 50,
          blockPII: true,
        },
      });
      expect(agent.guardrails.maxTokens).toBe(4096);
      expect(agent.guardrails.timeoutMs).toBe(60000);
      expect(agent.guardrails.costLimitPerCallCents).toBe(50);
      expect(agent.guardrails.blockPII).toBe(true);
    });
  });

  describe('validation errors', () => {
    test('throws on missing config', () => {
      expect(() => defineAgent()).toThrow(AgentValidationError);
      expect(() => defineAgent(null)).toThrow(AgentValidationError);
    });

    test('throws on missing name', () => {
      expect(() =>
        defineAgent({ model: 'claude-sonnet-4-20250514', systemPrompt: 'x' })
      ).toThrow(AgentValidationError);
    });

    test('throws on invalid name format (uppercase)', () => {
      expect(() =>
        defineAgent({ name: 'Test.bad.v1', model: 'claude-x', systemPrompt: 'x' })
      ).toThrow(/does not match required format/);
    });

    test('throws on invalid name format (missing version)', () => {
      expect(() =>
        defineAgent({ name: 'test.bad', model: 'claude-x', systemPrompt: 'x' })
      ).toThrow(/does not match required format/);
    });

    test('throws on non-claude model', () => {
      expect(() =>
        defineAgent({ name: 'test.m.v1', model: 'gpt-4', systemPrompt: 'x' })
      ).toThrow(/must start with "claude-"/);
    });

    test('throws on missing systemPrompt', () => {
      expect(() =>
        defineAgent({ name: 'test.sp.v1', model: 'claude-sonnet-4-20250514' })
      ).toThrow(/systemPrompt is required/);
    });

    test('throws on non-string, non-function systemPrompt', () => {
      expect(() =>
        defineAgent({
          name: 'test.sp.v1',
          model: 'claude-sonnet-4-20250514',
          systemPrompt: 123,
        })
      ).toThrow(/must be a string or function/);
    });

    test('throws on malformed tool', () => {
      expect(() =>
        defineAgent({
          name: 'test.t.v1',
          model: 'claude-sonnet-4-20250514',
          systemPrompt: 'x',
          tools: [{ name: 'foo' }], // missing description, input_schema
        })
      ).toThrow(/missing required fields/);
    });

    test('throws on maxTokens out of range', () => {
      expect(() =>
        defineAgent({
          name: 'test.mt.v1',
          model: 'claude-sonnet-4-20250514',
          systemPrompt: 'x',
          guardrails: { maxTokens: 0 },
        })
      ).toThrow(/guardrails.maxTokens must be in/);

      expect(() =>
        defineAgent({
          name: 'test.mt2.v1',
          model: 'claude-sonnet-4-20250514',
          systemPrompt: 'x',
          guardrails: { maxTokens: 999999 },
        })
      ).toThrow(/guardrails.maxTokens must be in/);
    });
  });
});

describe('Agent Runtime — runAgent', () => {
  let defineAgent, runAgent, AgentGuardrailError, AgentValidationError;
  let callClaudeMock;

  beforeEach(() => {
    // Fresh module reload per test so the mock takes effect
    jest.resetModules();

    callClaudeMock = jest.fn(async () => ({
      text: 'Hello world',
      usage: { input_tokens: 100, output_tokens: 50 },
      raw: {},
      content: [{ type: 'text', text: 'Hello world' }],
      stop_reason: 'end_turn',
    }));

    jest.doMock('../server/services/ai/anthropicClient', () => ({
      callClaude: callClaudeMock,
      CLAUDE_URL: 'https://api.anthropic.com/v1/messages',
      DEFAULT_MODEL: 'claude-sonnet-4-20250514',
    }));

    // Mock metrics so we don't need a real Prometheus registry
    jest.doMock('../server/services/metrics', () => ({
      agentRequestsTotal: { inc: jest.fn() },
      agentTokensTotal: { inc: jest.fn() },
      agentCostTotalCents: { inc: jest.fn() },
      agentGuardrailViolationsTotal: { inc: jest.fn() },
      agentCostOverrunsTotal: { inc: jest.fn() },
    }));

    // Mock logger
    jest.doMock('../server/services/logger', () => ({
      aiLogger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
    }));

    ({ defineAgent, runAgent, AgentGuardrailError, AgentValidationError } = require('../server/services/ai/agentRuntime'));
  });

  describe('happy path', () => {
    test('resolves string systemPrompt and calls callClaude', async () => {
      const agent = defineAgent({
        name: 'test.hp.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'You are a test.',
      });
      const result = await runAgent(agent, {
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(callClaudeMock).toHaveBeenCalledTimes(1);
      const args = callClaudeMock.mock.calls[0][0];
      expect(args.systemPrompt).toBe('You are a test.');
      expect(args.model).toBe('claude-sonnet-4-20250514');
      expect(args.maxTokens).toBe(1000);
      expect(result.text).toBe('Hello world');
      expect(result.agent.name).toBe('test.hp.v1');
      expect(result.agent.model).toBe('claude-sonnet-4-20250514');
      expect(result.agent.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('resolves function systemPrompt with context', async () => {
      const agent = defineAgent({
        name: 'test.fn.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: (ctx) => `Hello ${ctx.name}`,
      });
      await runAgent(agent, {
        messages: [{ role: 'user', content: 'hi' }],
        context: { name: 'Ellery' },
      });
      expect(callClaudeMock.mock.calls[0][0].systemPrompt).toBe('Hello Ellery');
    });

    test('resolves async function systemPrompt', async () => {
      const agent = defineAgent({
        name: 'test.async.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: async (ctx) => {
          await new Promise(r => setTimeout(r, 5));
          return `Async ${ctx.val}`;
        },
      });
      await runAgent(agent, {
        messages: [{ role: 'user', content: 'hi' }],
        context: { val: 42 },
      });
      expect(callClaudeMock.mock.calls[0][0].systemPrompt).toBe('Async 42');
    });

    test('forwards agent_name and project_id into tracking.extra', async () => {
      const agent = defineAgent({
        name: 'test.track.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'x',
      });
      await runAgent(agent, {
        messages: [{ role: 'user', content: 'hi' }],
        tracking: {
          requestId: 'req_123',
          personId: 'person_abc',
          projectId: 'project_xyz',
        },
      });
      const tracking = callClaudeMock.mock.calls[0][0].tracking;
      expect(tracking.extra.agent_name).toBe('test.track.v1');
      expect(tracking.extra.project_id).toBe('project_xyz');
      expect(tracking.requestId).toBe('req_123');
      expect(tracking.personId).toBe('person_abc');
    });

    test('defaults project_id to "default" if not provided', async () => {
      const agent = defineAgent({
        name: 'test.def.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'x',
      });
      await runAgent(agent, { messages: [{ role: 'user', content: 'hi' }] });
      const tracking = callClaudeMock.mock.calls[0][0].tracking;
      expect(tracking.extra.project_id).toBe('default');
    });

    test('returns superset shape including agent metadata', async () => {
      const agent = defineAgent({
        name: 'test.ret.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'x',
      });
      const result = await runAgent(agent, { messages: [{ role: 'user', content: 'hi' }] });
      expect(result).toHaveProperty('text');
      expect(result).toHaveProperty('parsed');
      expect(result).toHaveProperty('parseError');
      expect(result).toHaveProperty('usage');
      expect(result).toHaveProperty('raw');
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('stop_reason');
      expect(result).toHaveProperty('agent');
      expect(result.agent).toHaveProperty('name');
      expect(result.agent).toHaveProperty('model');
      expect(result.agent).toHaveProperty('durationMs');
      expect(result.agent).toHaveProperty('costCents');
    });

    test('clamps maxTokens to guardrails.maxTokens even if override tries higher', async () => {
      const agent = defineAgent({
        name: 'test.clamp.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'x',
        guardrails: { maxTokens: 500 },
      });
      await runAgent(agent, {
        messages: [{ role: 'user', content: 'hi' }],
        overrides: { maxTokens: 999999 },
      });
      expect(callClaudeMock.mock.calls[0][0].maxTokens).toBe(500);
    });

    test('allows model override via overrides.model', async () => {
      const agent = defineAgent({
        name: 'test.mo.v1',
        model: 'claude-opus-4-20250514',
        systemPrompt: 'x',
      });
      await runAgent(agent, {
        messages: [{ role: 'user', content: 'hi' }],
        overrides: { model: 'claude-sonnet-4-20250514' },
      });
      expect(callClaudeMock.mock.calls[0][0].model).toBe('claude-sonnet-4-20250514');
    });
  });

  describe('guardrails', () => {
    test('throws AgentGuardrailError when enabled=false', async () => {
      const agent = defineAgent({
        name: 'test.disabled.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'x',
        guardrails: { enabled: false },
      });
      await expect(
        runAgent(agent, { messages: [{ role: 'user', content: 'hi' }] })
      ).rejects.toThrow(AgentGuardrailError);
      expect(callClaudeMock).not.toHaveBeenCalled();
    });

    test('throws AgentGuardrailError when costLimitPerCallCents estimate exceeded', async () => {
      const agent = defineAgent({
        name: 'test.cost.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'x',
        guardrails: { maxTokens: 200000, costLimitPerCallCents: 1 }, // 1¢ is unreasonably low
      });
      await expect(
        runAgent(agent, {
          messages: [{ role: 'user', content: 'some very long prompt that exceeds the 1 cent budget easily'.repeat(100) }],
        })
      ).rejects.toThrow(/exceeds limit/);
      expect(callClaudeMock).not.toHaveBeenCalled();
    });

    test('accepts calls under costLimitPerCallCents', async () => {
      const agent = defineAgent({
        name: 'test.ok.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'x',
        guardrails: { costLimitPerCallCents: 10000 }, // $100
      });
      await expect(
        runAgent(agent, { messages: [{ role: 'user', content: 'hi' }] })
      ).resolves.toBeDefined();
    });

    test('dynamicTools=true requires overrides.tools', async () => {
      const agent = defineAgent({
        name: 'test.dyn.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'x',
        dynamicTools: true,
      });
      await expect(
        runAgent(agent, { messages: [{ role: 'user', content: 'hi' }] })
      ).rejects.toThrow(AgentValidationError);
    });

    test('non-dynamic agent rejects overrides.tools', async () => {
      const agent = defineAgent({
        name: 'test.static.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'x',
      });
      await expect(
        runAgent(agent, {
          messages: [{ role: 'user', content: 'hi' }],
          overrides: {
            tools: [{ name: 'foo', description: 'x', input_schema: {} }],
          },
        })
      ).rejects.toThrow(/is not dynamicTools/);
    });
  });

  describe('JSON auto-parse', () => {
    test('auto-parses when systemPrompt contains "Return ONLY valid JSON"', async () => {
      callClaudeMock.mockResolvedValueOnce({
        text: '{"ok": true, "count": 42}',
        usage: { input_tokens: 10, output_tokens: 5 },
        raw: {},
        content: [],
        stop_reason: 'end_turn',
      });
      const agent = defineAgent({
        name: 'test.json.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'Analyze the input. Return ONLY valid JSON (no markdown).',
      });
      const result = await runAgent(agent, { messages: [{ role: 'user', content: 'hi' }] });
      expect(result.parsed).toEqual({ ok: true, count: 42 });
      expect(result.parseError).toBe(null);
    });

    test('returns parseError when JSON is invalid', async () => {
      callClaudeMock.mockResolvedValueOnce({
        text: 'not json at all',
        usage: { input_tokens: 10, output_tokens: 5 },
        raw: {},
        content: [],
        stop_reason: 'end_turn',
      });
      const agent = defineAgent({
        name: 'test.jsonbad.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'Return ONLY valid JSON.',
      });
      const result = await runAgent(agent, { messages: [{ role: 'user', content: 'hi' }] });
      expect(result.parsed).toBe(null);
      expect(result.parseError).toBeTruthy();
    });

    test('strips markdown fences before parsing', async () => {
      callClaudeMock.mockResolvedValueOnce({
        text: '```json\n{"value": "wrapped"}\n```',
        usage: { input_tokens: 10, output_tokens: 5 },
        raw: {},
        content: [],
        stop_reason: 'end_turn',
      });
      const agent = defineAgent({
        name: 'test.jsonmd.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'Return ONLY valid JSON (no markdown).',
      });
      const result = await runAgent(agent, { messages: [{ role: 'user', content: 'hi' }] });
      expect(result.parsed).toEqual({ value: 'wrapped' });
    });

    test('does NOT auto-parse when systemPrompt has no JSON instruction', async () => {
      const agent = defineAgent({
        name: 'test.nojson.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'You are a helpful assistant.',
      });
      const result = await runAgent(agent, { messages: [{ role: 'user', content: 'hi' }] });
      expect(result.parsed).toBe(null);
      expect(result.parseError).toBe(null);
    });
  });

  describe('error handling', () => {
    test('propagates callClaude errors', async () => {
      callClaudeMock.mockRejectedValueOnce(new Error('Claude API failed: 500'));
      const agent = defineAgent({
        name: 'test.err.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'x',
      });
      await expect(
        runAgent(agent, { messages: [{ role: 'user', content: 'hi' }] })
      ).rejects.toThrow('Claude API failed: 500');
    });

    test('validates opts.messages is an array', async () => {
      const agent = defineAgent({
        name: 'test.badmsg.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'x',
      });
      await expect(
        runAgent(agent, { messages: 'not an array' })
      ).rejects.toThrow(/messages must be an array/);
    });

    test('validates agent is a definition', async () => {
      await expect(
        runAgent(null, { messages: [] })
      ).rejects.toThrow(/must be an agent definition/);
      await expect(
        runAgent({}, { messages: [] })
      ).rejects.toThrow(/must be an agent definition/);
    });

    test('rejects invalid overrides.maxTokens (0)', async () => {
      const agent = defineAgent({
        name: 'test.mt0.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'x',
      });
      await expect(
        runAgent(agent, {
          messages: [{ role: 'user', content: 'hi' }],
          overrides: { maxTokens: 0 },
        })
      ).rejects.toThrow(AgentValidationError);
    });

    test('rejects invalid overrides.maxTokens (negative)', async () => {
      const agent = defineAgent({
        name: 'test.mtneg.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'x',
      });
      await expect(
        runAgent(agent, {
          messages: [{ role: 'user', content: 'hi' }],
          overrides: { maxTokens: -100 },
        })
      ).rejects.toThrow(/finite integer/);
    });

    test('rejects invalid overrides.maxTokens (NaN)', async () => {
      const agent = defineAgent({
        name: 'test.mtnan.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'x',
      });
      await expect(
        runAgent(agent, {
          messages: [{ role: 'user', content: 'hi' }],
          overrides: { maxTokens: NaN },
        })
      ).rejects.toThrow(/finite integer/);
    });

    test('translates AbortError to AgentTimeoutError', async () => {
      const { AgentTimeoutError } = require('../server/services/ai/agentRuntime');
      callClaudeMock.mockImplementationOnce(async () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      });
      const agent = defineAgent({
        name: 'test.timeout.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'x',
      });
      await expect(
        runAgent(agent, { messages: [{ role: 'user', content: 'hi' }] })
      ).rejects.toThrow(AgentTimeoutError);
    });
  });

  describe('deep-freeze immutability', () => {
    test('tool objects cannot be mutated after defineAgent', () => {
      const agent = defineAgent({
        name: 'test.frozen.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'x',
        tools: [
          { name: 'foo', description: 'd', input_schema: { type: 'object', properties: {} } },
        ],
      });
      expect(Object.isFrozen(agent.tools[0])).toBe(true);
      // In strict mode (test runner) this throws; in non-strict it silently fails.
      // Assert via isFrozen + try/catch fallback.
      let mutated = false;
      try {
        agent.tools[0].name = 'hacked';
        if (agent.tools[0].name === 'hacked') mutated = true;
      } catch (_) {
        // expected in strict mode
      }
      expect(mutated).toBe(false);
    });

    test('mcpServers entries are deep-frozen', () => {
      const agent = defineAgent({
        name: 'test.mcpfrozen.v1',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'x',
        mcpServers: [{ name: 'hasura', url: 'http://localhost:8080' }],
      });
      expect(Object.isFrozen(agent.mcpServers[0])).toBe(true);
    });
  });
});

describe('Bypass Regression — grep guards', () => {
  const fs = require('fs');
  const path = require('path');

  test('no direct fetch to api.anthropic.com in server/routes/ (after Milestone C)', () => {
    // Milestone A is additive only — this test will start passing after Milestone C
    // lands, but we define the invariant now. Until then, track jsa.js as the known
    // remaining bypass. Once C is done, remove the allowlist entirely.
    const routesDir = path.join(__dirname, '..', 'server', 'routes');
    const allowedBypasses = new Set(['jsa.js']); // TODO: empty this after Milestone C
    const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));
    const violators = [];
    for (const f of files) {
      if (allowedBypasses.has(f)) continue;
      const content = fs.readFileSync(path.join(routesDir, f), 'utf8');
      if (/fetch\s*\(\s*['"]https:\/\/api\.anthropic\.com/.test(content)) {
        violators.push(f);
      }
    }
    expect(violators).toEqual([]);
  });

  test('agentRuntime.js exists and exports the expected surface', () => {
    const { defineAgent, runAgent, AgentValidationError, AgentGuardrailError, AgentTimeoutError } =
      require('../server/services/ai/agentRuntime');
    expect(typeof defineAgent).toBe('function');
    expect(typeof runAgent).toBe('function');
    expect(typeof AgentValidationError).toBe('function');
    expect(typeof AgentGuardrailError).toBe('function');
    expect(typeof AgentTimeoutError).toBe('function');
  });
});
