/**
 * AI SERVICES TESTS
 * Tests the extracted AI service modules for correctness.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVICES = path.join(ROOT, 'server/services/ai');

describe('AI service modules exist', () => {
  const modules = ['tradePrompts.js', 'contextLoader.js', 'promptBuilder.js', 'openaiClient.js', 'anthropicClient.js'];

  modules.forEach(mod => {
    test(`${mod} exists`, () => {
      expect(fs.existsSync(path.join(SERVICES, mod))).toBe(true);
    });
  });
});

describe('tradePrompts module', () => {
  const { TRADE_WHISPER_PROMPTS, getTradeWhisperPrompt } = require('../server/services/ai/tradePrompts');

  test('exports all trade prompts', () => {
    expect(TRADE_WHISPER_PROMPTS.electrical).toBeDefined();
    expect(TRADE_WHISPER_PROMPTS.instrumentation).toBeDefined();
    expect(TRADE_WHISPER_PROMPTS.pipe_fitting).toBeDefined();
    expect(TRADE_WHISPER_PROMPTS.safety).toBeDefined();
    expect(TRADE_WHISPER_PROMPTS.default).toBeDefined();
  });

  test('electrical prompt contains trade-specific terms', () => {
    expect(TRADE_WHISPER_PROMPTS.electrical).toContain('conduit');
    expect(TRADE_WHISPER_PROMPTS.electrical).toContain('MCC');
    expect(TRADE_WHISPER_PROMPTS.electrical).toContain('transformer');
  });

  test('instrumentation prompt contains trade-specific terms', () => {
    expect(TRADE_WHISPER_PROMPTS.instrumentation).toContain('transmitter');
    expect(TRADE_WHISPER_PROMPTS.instrumentation).toContain('HART');
    expect(TRADE_WHISPER_PROMPTS.instrumentation).toContain('DCS');
  });

  test('getTradeWhisperPrompt returns default for null personId', async () => {
    const result = await getTradeWhisperPrompt(null);
    expect(result).toBe(TRADE_WHISPER_PROMPTS.default);
  });
});

describe('contextLoader module', () => {
  const { loadSafetyBasics, loadPersonContext, loadSafetyContext, detectTrade, loadTradeKnowledge } = require('../server/services/ai/contextLoader');

  test('loadSafetyBasics returns data or null', () => {
    const result = loadSafetyBasics();
    // Should return object if file exists, null otherwise
    if (result) {
      expect(typeof result).toBe('object');
    } else {
      expect(result).toBeNull();
    }
  });

  test('loadPersonContext returns empty string for null', async () => {
    const result = await loadPersonContext(null);
    expect(result).toBe('');
  });

  test('loadSafetyContext returns string', () => {
    const result = loadSafetyContext();
    expect(typeof result).toBe('string');
  });

  test('detectTrade identifies trades correctly', () => {
    expect(detectTrade('Working on Instrumentation controls')).toBe('instrumentation');
    expect(detectTrade('Pipe Fitting installation')).toBe('pipefitting');
    expect(detectTrade('Industrial Erection work')).toBe('erection');
    expect(detectTrade('Safety department')).toBe('safety');
    expect(detectTrade('General construction')).toBe('electrical'); // default
  });

  test('loadTradeKnowledge returns string', () => {
    const result = loadTradeKnowledge('electrical', 'pulling cable in tray');
    expect(typeof result).toBe('string');
  });
});

describe('promptBuilder module', () => {
  const { buildSafetyBlock, buildContextPackage, buildStructurePrompt, buildConversePrompt } = require('../server/services/ai/promptBuilder');

  test('buildSafetyBlock returns empty string for null', () => {
    expect(buildSafetyBlock(null)).toBe('');
  });

  test('buildSafetyBlock includes safety rules', () => {
    const result = buildSafetyBlock({
      safety_rules: ['Wear hard hat', 'Use fall protection'],
      tools_and_equipment: ['Inspect tools daily'],
      safety_vocabulary: ['PPE', 'JSA'],
    });
    expect(result).toContain('Wear hard hat');
    expect(result).toContain('PPE');
  });

  test('buildContextPackage returns null for missing person/template', () => {
    expect(buildContextPackage(null, null)).toBeNull();
    expect(buildContextPackage(null, {})).toBeNull();
    expect(buildContextPackage({}, null)).toBeNull();
  });

  test('buildContextPackage builds correct shape', () => {
    const ctx = buildContextPackage(
      { name: 'Steve', role_title: 'Electrician', personal_context: {} },
      { role_description: 'Journeyman', report_focus: 'Daily work', output_sections: ['Summary', 'Details'], vocabulary: { terms: ['conduit', 'MCC'] }, safety_rules: ['Wear PPE'] }
    );
    expect(ctx.person_name).toBe('Steve');
    expect(ctx.role_title).toBe('Electrician');
    expect(ctx.output_sections).toContain('Summary');
    expect(ctx.vocabulary_terms).toContain('conduit');
  });

  test('buildStructurePrompt returns fallback for null context', () => {
    const prompt = buildStructurePrompt(null, '');
    expect(prompt).toContain('Horizon Sparks');
    expect(prompt).toContain('verbatim');
    expect(prompt).toContain('structured');
  });

  test('buildStructurePrompt includes person context', () => {
    const ctx = {
      person_name: 'Miguel',
      role_title: 'Foreman',
      role_description: 'Electrical Foreman',
      report_focus: 'Crew management',
      output_sections: ['Summary', 'Safety'],
      vocabulary_terms: 'conduit, MCC',
      language_notes: '',
      personal_experience: '15 years',
      personal_specialties: 'Switchgear',
      personal_notes: '',
      personal_certifications: 'Master Electrician',
      safety_rules: ['Wear PPE'],
      safety_vocabulary: ['LOTO'],
      tools_and_equipment: ['Megger'],
      safety_notes: '',
    };
    const prompt = buildStructurePrompt(ctx, '');
    expect(prompt).toContain('Miguel');
    expect(prompt).toContain('Foreman');
    expect(prompt).toContain('15 years');
    expect(prompt).toContain('Master Electrician');
    expect(prompt).toContain('Switchgear');
  });

  test('buildConversePrompt includes worker name and role', () => {
    const prompt = buildConversePrompt({
      personName: 'Steve Patel',
      roleTitle: 'Senior Instrument Tech',
      roleDescription: 'Lead technician for calibration',
      reportFocus: 'Loop checks',
      outputSections: ['Summary', 'Calibration Data'],
      messagesForPerson: [{ from: 'Safety Officer', text: 'Check fire extinguisher' }],
    });
    expect(prompt).toContain('Steve Patel');
    expect(prompt).toContain('Senior Instrument Tech');
    expect(prompt).toContain('fire extinguisher');
    expect(prompt).toContain('Steve'); // first name usage
  });

  test('buildConversePrompt handles no messages', () => {
    const prompt = buildConversePrompt({
      personName: 'John',
      roleTitle: 'Helper',
      roleDescription: '',
      outputSections: [],
    });
    expect(prompt).toContain('John');
    expect(prompt).not.toContain('IMPORTANT MESSAGES');
  });
});

describe('openaiClient module', () => {
  const openai = require('../server/services/ai/openaiClient');

  test('exports MIME_MAP', () => {
    expect(openai.MIME_MAP.m4a).toBe('audio/mp4');
    expect(openai.MIME_MAP.webm).toBe('audio/webm');
    expect(openai.MIME_MAP.mp3).toBe('audio/mpeg');
  });

  test('exports transcribe function', () => {
    expect(typeof openai.transcribe).toBe('function');
  });

  test('exports textToSpeech function', () => {
    expect(typeof openai.textToSpeech).toBe('function');
  });

  test('exports textToSpeechBase64 function', () => {
    expect(typeof openai.textToSpeechBase64).toBe('function');
  });
});

describe('anthropicClient module', () => {
  const anthropic = require('../server/services/ai/anthropicClient');

  test('exports correct API URL', () => {
    expect(anthropic.CLAUDE_URL).toBe('https://api.anthropic.com/v1/messages');
  });

  test('exports callClaude function', () => {
    expect(typeof anthropic.callClaude).toBe('function');
  });

  test('exports callClaudeJSON function', () => {
    expect(typeof anthropic.callClaudeJSON).toBe('function');
  });

  test('exports cleanupFieldText function', () => {
    expect(typeof anthropic.cleanupFieldText).toBe('function');
  });
});

describe('ai.js imports extracted modules', () => {
  const aiContent = fs.readFileSync(path.join(ROOT, 'server/routes/ai.js'), 'utf8');

  test('imports tradePrompts', () => {
    expect(aiContent).toContain("require('../services/ai/tradePrompts')");
  });

  test('imports contextLoader', () => {
    expect(aiContent).toContain("require('../services/ai/contextLoader')");
  });

  test('does NOT define TRADE_WHISPER_PROMPTS inline', () => {
    expect(aiContent).not.toMatch(/^const TRADE_WHISPER_PROMPTS = \{/m);
  });
});
