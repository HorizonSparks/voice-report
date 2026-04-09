/**
 * Agent Definitions Tests — Phase 1 Milestone B
 *
 * For each agent file: loads it, asserts the shape is a frozen agent definition,
 * and exercises systemPrompt resolution with a minimal fixture so we know it
 * won't crash at runtime.
 */

const path = require('path');

// Full contextPackage fixture (buildStructurePrompt needs many fields)
const FULL_CONTEXT_PACKAGE = {
  person_name: 'Test Worker',
  role_title: 'Electrician',
  role_description: 'Senior field electrician',
  personal_experience: '10 years',
  personal_specialties: 'cable pulling, terminations',
  personal_certifications: 'OSHA 30, NFPA 70E',
  report_focus: '',
  language_notes: '',
  vocabulary_terms: 'LOTO, arc flash, MCC',
  personal_notes: '',
  knowledge_context: '',
  safety_rules: ['wear PPE', 'verify LOTO'],
  tools_and_equipment: ['multimeter'],
  safety_vocabulary: ['PPE'],
  safety_notes: '',
  output_sections: ['Summary', 'Work Performed', 'Issues'],
  trade: 'electrical',
};

describe('Agent Definitions — shape and loading', () => {
  let agents;

  beforeAll(() => {
    agents = require('../server/services/ai/agents');
  });

  test('index exports all expected agents', () => {
    expect(agents).toHaveProperty('voiceStructure');
    expect(agents).toHaveProperty('voiceConverse');
    expect(agents).toHaveProperty('voiceRefine');
    expect(agents).toHaveProperty('jsaAnalyzer');
    expect(agents).toHaveProperty('sparksChat');
    expect(agents).toHaveProperty('fieldCleanup');
    expect(agents).toHaveProperty('pidVerifier');
  });

  test('all agents have unique names', () => {
    const names = Object.values(agents).map(a => a.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  test('all agents are frozen', () => {
    for (const [key, agent] of Object.entries(agents)) {
      expect(Object.isFrozen(agent)).toBe(true);
      expect(Object.isFrozen(agent.tools)).toBe(true);
      expect(Object.isFrozen(agent.mcpServers)).toBe(true);
      expect(Object.isFrozen(agent.guardrails)).toBe(true);
    }
  });

  test('all agent names match the canonical format', () => {
    const regex = /^[a-z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)*\.v\d+$/;
    for (const [key, agent] of Object.entries(agents)) {
      expect(agent.name).toMatch(regex);
    }
  });

  test('all agents use Claude models', () => {
    for (const [key, agent] of Object.entries(agents)) {
      expect(agent.model).toMatch(/^claude-/);
    }
  });
});

describe('voiceStructure agent', () => {
  let agent;

  beforeAll(() => {
    agent = require('../server/services/ai/agents/voiceStructure');
  });

  test('name is voice.structure.v1', () => {
    expect(agent.name).toBe('voice.structure.v1');
  });

  test('resolves fallback prompt with null contextPackage', () => {
    const sp = agent.systemPrompt({ contextPackage: null });
    expect(typeof sp).toBe('string');
    expect(sp.length).toBeGreaterThan(100);
    expect(sp).toContain('Horizon Sparks');
  });

  test('resolves trade-specific prompt with full contextPackage', () => {
    const sp = agent.systemPrompt({ contextPackage: FULL_CONTEXT_PACKAGE, safetyBlock: '' });
    expect(typeof sp).toBe('string');
    expect(sp).toContain('Test Worker');
    expect(sp).toContain('Electrician');
  });

  test('routes to Sparks prompt when trade is sparks', () => {
    const sparksCtx = { ...FULL_CONTEXT_PACKAGE, trade: 'sparks' };
    const sp = agent.systemPrompt({ contextPackage: sparksCtx, safetyBlock: '' });
    expect(sp).toContain('Horizon Sparks');
    // Sparks prompt explicitly says "not a construction crew"
    expect(sp).toContain('SOFTWARE TEAM');
  });

  test('has maxTokens 4096 and costLimit 20 cents', () => {
    expect(agent.guardrails.maxTokens).toBe(4096);
    expect(agent.guardrails.costLimitPerCallCents).toBe(20);
  });
});

describe('voiceConverse agent', () => {
  let agent;

  beforeAll(() => {
    agent = require('../server/services/ai/agents/voiceConverse');
  });

  test('name is voice.converse.v1', () => {
    expect(agent.name).toBe('voice.converse.v1');
  });

  test('resolves prompt with minimal context', () => {
    const sp = agent.systemPrompt({
      personName: 'Test Worker',
      roleTitle: 'Electrician',
      roleDescription: 'senior',
      reportFocus: '',
      outputSections: ['Summary'],
      messagesForPerson: [],
      trade: 'electrical',
    });
    expect(typeof sp).toBe('string');
    expect(sp).toContain('Test');
  });

  test('routes to Sparks converse when trade is sparks', () => {
    const sp = agent.systemPrompt({
      personName: 'Dev',
      roleTitle: 'Engineer',
      roleDescription: 'backend',
      reportFocus: '',
      outputSections: ['Progress'],
      messagesForPerson: [],
      trade: 'sparks',
    });
    expect(sp).toContain('software team');
  });

  test('costLimit is 5 cents (short responses)', () => {
    expect(agent.guardrails.costLimitPerCallCents).toBe(5);
  });
});

describe('voiceRefine agent', () => {
  let agent;

  beforeAll(() => {
    agent = require('../server/services/ai/agents/voiceRefine');
  });

  test('name is voice.refine.v1', () => {
    expect(agent.name).toBe('voice.refine.v1');
  });

  test('resolves dialogue phase prompt', () => {
    const sp = agent.systemPrompt({
      phase: 'dialogue',
      contextType: 'daily_task',
      opts: { round: 1, personContext: 'Test worker' },
    });
    expect(typeof sp).toBe('string');
    expect(sp.length).toBeGreaterThan(100);
  });

  test('resolves finalize phase prompt', () => {
    const sp = agent.systemPrompt({
      phase: 'finalize',
      contextType: 'punch_list',
      opts: { personContext: 'Test worker' },
    });
    expect(sp).toContain('JSON');
  });

  test('resolves edit phase prompt', () => {
    const sp = agent.systemPrompt({
      phase: 'edit',
      contextType: 'daily_task',
      opts: { personContext: 'Test worker' },
    });
    expect(sp).toContain('editing');
  });

  test('throws when phase is missing', () => {
    expect(() => agent.systemPrompt({})).toThrow(/phase is required/);
  });
});

describe('jsaAnalyzer agent', () => {
  let mod;

  beforeAll(() => {
    mod = require('../server/services/ai/agents/jsaAnalyzer');
  });

  test('name is voice.jsaMatchCheck.v1', () => {
    expect(mod.name).toBe('voice.jsaMatchCheck.v1');
  });

  test('systemPrompt is STATIC (no variable interpolation)', () => {
    expect(typeof mod.systemPrompt).toBe('string');
    expect(mod.systemPrompt).toContain('construction safety expert');
    expect(mod.systemPrompt).toContain('Return ONLY valid JSON');
    // Security: system prompt must NOT contain placeholders for user data
    expect(mod.systemPrompt).not.toContain('${');
    expect(mod.systemPrompt).not.toMatch(/jsa_task_description|task_title|task_description/i);
  });

  test('exports JSA_SYSTEM_PROMPT and buildUserContent helpers', () => {
    expect(typeof mod.JSA_SYSTEM_PROMPT).toBe('string');
    expect(mod.JSA_SYSTEM_PROMPT).toBe(mod.systemPrompt);
    expect(typeof mod.buildUserContent).toBe('function');
  });

  test('buildUserContent assembles all three fields', () => {
    const content = mod.buildUserContent({
      jsa_task_description: 'Work near energized panel',
      task_title: 'Install breaker',
      task_description: 'Replace 30A breaker in panel P-101',
    });
    expect(content).toContain('JSA Task Description: "Work near energized panel"');
    expect(content).toContain('Assigned Task: "Install breaker"');
    expect(content).toContain('Task Details: "Replace 30A breaker in panel P-101"');
  });

  test('buildUserContent omits Task Details when task_description missing', () => {
    const content = mod.buildUserContent({
      jsa_task_description: 'pipe welding',
      task_title: 'weld flange',
    });
    expect(content).toContain('pipe welding');
    expect(content).toContain('weld flange');
    expect(content).not.toContain('Task Details');
  });

  test('buildUserContent throws when required fields missing', () => {
    expect(() => mod.buildUserContent({ jsa_task_description: 'x' })).toThrow(/required/);
    expect(() => mod.buildUserContent({ task_title: 'x' })).toThrow(/required/);
    expect(() => mod.buildUserContent({})).toThrow(/required/);
  });

  test('has maxTokens 500 and costLimit 3 cents', () => {
    expect(mod.guardrails.maxTokens).toBe(500);
    expect(mod.guardrails.costLimitPerCallCents).toBe(3);
  });

  test('systemPrompt ends with JSON instruction (triggers auto-parse)', () => {
    expect(mod.systemPrompt).toMatch(/Return ONLY valid JSON/i);
  });

  // Exact-string parity test — catches prompt drift (Codex audit request)
  test('systemPrompt EXACTLY matches canonical JSA instruction', () => {
    const canonical =
      'You are a construction safety expert. Compare the JSA (Job Safety Analysis) ' +
      'task description against the assigned work task provided in the user message. ' +
      'Determine if the JSA adequately covers the hazards of the task.\n\n' +
      'Return ONLY valid JSON (no markdown): { "match": boolean, "confidence": "high"|"medium"|"low", "reason": "brief explanation", "missing_hazards": ["hazard1", "hazard2"] }\n' +
      'If the work is substantially the same, match=true. If different work types, ' +
      'locations, or equipment, match=false with missing_hazards.';
    expect(mod.systemPrompt).toBe(canonical);
  });
});


describe('sparksChat agent', () => {
  let agent;

  beforeAll(() => {
    agent = require('../server/services/ai/agents/sparksChat');
  });

  test('name is voice.sparks.v1', () => {
    expect(agent.name).toBe('voice.sparks.v1');
  });

  test('dynamicTools flag is true', () => {
    expect(agent.dynamicTools).toBe(true);
  });

  test('accepts pre-built systemPrompt via context', () => {
    const built = 'You are a Sparks admin copilot. Tools available: lookup_person.';
    const sp = agent.systemPrompt({ systemPrompt: built });
    expect(sp).toBe(built);
  });

  test('throws when context.systemPrompt is missing', () => {
    expect(() => agent.systemPrompt({})).toThrow(/systemPrompt is required/);
    expect(() => agent.systemPrompt({ systemPrompt: '' })).toThrow(/systemPrompt is required/);
  });

  test('has costLimit 50 cents (chat can burn tokens in tool loops)', () => {
    expect(agent.guardrails.costLimitPerCallCents).toBe(50);
  });
});

describe('fieldCleanup agent', () => {
  let mod;

  beforeAll(() => {
    mod = require('../server/services/ai/agents/fieldCleanup');
  });

  test('name is voice.fieldCleanup.v1', () => {
    expect(mod.name).toBe('voice.fieldCleanup.v1');
  });

  test('systemPrompt is a function that returns instruction only (no text)', () => {
    expect(typeof mod.systemPrompt).toBe('function');
    const defaultPrompt = mod.systemPrompt({});
    expect(defaultPrompt).toContain('professional construction safety/work form');
    expect(defaultPrompt).toContain('Return ONLY the cleaned text');
    // Security: system prompt must NOT contain spoken text
    expect(defaultPrompt).not.toContain('Spoken text');
  });

  test('systemPrompt returns DEFAULT_CLEANUP_INSTRUCTION when no customPrompt', () => {
    const defaultPrompt = mod.systemPrompt({});
    expect(defaultPrompt).toBe(mod.DEFAULT_CLEANUP_INSTRUCTION);
  });

  test('systemPrompt returns customPrompt when provided', () => {
    const sp = mod.systemPrompt({ customPrompt: 'Convert to title case.' });
    expect(sp).toBe('Convert to title case.');
    expect(sp).not.toContain('professional construction safety/work form');
  });

  test('systemPrompt handles null context gracefully', () => {
    expect(mod.systemPrompt(null)).toBe(mod.DEFAULT_CLEANUP_INSTRUCTION);
    expect(mod.systemPrompt(undefined)).toBe(mod.DEFAULT_CLEANUP_INSTRUCTION);
  });

  test('buildUserContent wraps spoken text', () => {
    const content = mod.buildUserContent('he aint wearing no ppe');
    expect(content).toBe('Spoken text: "he aint wearing no ppe"');
  });

  test('buildUserContent throws when text is not a string', () => {
    expect(() => mod.buildUserContent(42)).toThrow(/string/);
    expect(() => mod.buildUserContent(null)).toThrow(/string/);
    expect(() => mod.buildUserContent(undefined)).toThrow(/string/);
  });

  test('has small guardrails (costLimit 2 cents)', () => {
    expect(mod.guardrails.costLimitPerCallCents).toBe(2);
    expect(mod.guardrails.maxTokens).toBe(500);
  });

  // Exact-string parity test (Codex audit request)
  test('DEFAULT_CLEANUP_INSTRUCTION EXACTLY matches the legacy cleanupFieldText prompt', () => {
    const canonical =
      'Clean up this spoken text for a professional construction safety/work form. ' +
      'Fix grammar, make it clear and concise, but keep the original meaning and all ' +
      'specific details (names, numbers, locations, equipment). Do NOT add information ' +
      "that wasn't said. Return ONLY the cleaned text, nothing else.";
    expect(mod.DEFAULT_CLEANUP_INSTRUCTION).toBe(canonical);
  });
});


describe('pidVerifier stub agent', () => {
  let agent, runAgent, AgentGuardrailError;

  beforeAll(() => {
    agent = require('../server/services/ai/agents/pidVerifier');
    ({ runAgent, AgentGuardrailError } = require('../server/services/ai/agentRuntime'));
  });

  test('name is loopfolders.pidVerifier.v1', () => {
    expect(agent.name).toBe('loopfolders.pidVerifier.v1');
  });

  test('is explicitly disabled via guardrails.enabled=false', () => {
    expect(agent.guardrails.enabled).toBe(false);
  });

  test('systemPrompt is a placeholder string', () => {
    expect(typeof agent.systemPrompt).toBe('string');
    expect(agent.systemPrompt).toContain('STUB');
  });

  test('runAgent throws AgentGuardrailError when called', async () => {
    await expect(
      runAgent(agent, { messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow(AgentGuardrailError);
  });
});

describe('Cross-cutting invariants', () => {
  let agents;

  beforeAll(() => {
    agents = require('../server/services/ai/agents');
  });

  test('non-stub agents have guardrails.enabled=true', () => {
    for (const [key, agent] of Object.entries(agents)) {
      if (key === 'pidVerifier') continue; // explicit stub
      expect(agent.guardrails.enabled).toBe(true);
    }
  });

  test('all agents have reasonable timeoutMs (> 0, <= 300000)', () => {
    for (const [key, agent] of Object.entries(agents)) {
      expect(agent.guardrails.timeoutMs).toBeGreaterThan(0);
      expect(agent.guardrails.timeoutMs).toBeLessThanOrEqual(300000);
    }
  });

  test('all agents have costLimitPerCallCents set (no unbounded spend)', () => {
    for (const [key, agent] of Object.entries(agents)) {
      expect(agent.guardrails.costLimitPerCallCents).toBeGreaterThan(0);
    }
  });

  test('maxTokens <= 200000 for all agents', () => {
    for (const [key, agent] of Object.entries(agents)) {
      expect(agent.guardrails.maxTokens).toBeLessThanOrEqual(200000);
    }
  });

  test('only sparksChat has dynamicTools flag', () => {
    for (const [key, agent] of Object.entries(agents)) {
      if (key === 'sparksChat') {
        expect(agent.dynamicTools).toBe(true);
      } else {
        expect(agent.dynamicTools).toBe(false);
      }
    }
  });
});
