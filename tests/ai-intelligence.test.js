/**
 * AI Intelligence Layer Tests
 * Tests for the smarter AI reasoning: dialogue state, safety detector,
 * knowledge cache, feedback capture, and incremental edit support.
 */

const { FIELD_SCHEMAS, getDialogueOutputInstruction, shouldFinalize, getNextPriorityField } = require('../server/services/ai/dialogueState');
const { detectSafety } = require('../server/services/ai/safetyDetector');
const { computeDiffs } = require('../server/services/ai/feedbackCapture');

// ============================================================
// Dialogue State
// ============================================================
describe('Dialogue State', () => {
  test('FIELD_SCHEMAS has all three context types', () => {
    expect(FIELD_SCHEMAS).toHaveProperty('daily_task');
    expect(FIELD_SCHEMAS).toHaveProperty('shift_update');
    expect(FIELD_SCHEMAS).toHaveProperty('punch_list');
  });

  test('each schema has required, important, and optional fields', () => {
    for (const [type, schema] of Object.entries(FIELD_SCHEMAS)) {
      expect(schema.required).toBeDefined();
      expect(schema.important).toBeDefined();
      expect(schema.optional).toBeDefined();
      expect(schema.labels).toBeDefined();
      expect(schema.required.length).toBeGreaterThan(0);
      // Every field should have a label
      const allFields = [...schema.required, ...schema.important, ...schema.optional];
      for (const f of allFields) {
        expect(schema.labels[f]).toBeDefined();
      }
    }
  });

  test('getDialogueOutputInstruction returns string with field names', () => {
    const instruction = getDialogueOutputInstruction('daily_task');
    expect(typeof instruction).toBe('string');
    expect(instruction).toContain('task_goal');
  });

  test('getDialogueOutputInstruction works for all context types', () => {
    for (const type of ['daily_task', 'shift_update', 'punch_list']) {
      const instruction = getDialogueOutputInstruction(type);
      expect(typeof instruction).toBe('string');
      expect(instruction.length).toBeGreaterThan(100);
    }
  });

  test('shouldFinalize returns true when required fields are known with confidence', () => {
    const result = {
      known_fields: { task_goal: 'Pull cable', assigned_to: 'Miguel', location: 'Rack 5A' },
      confidence_by_field: { task_goal: 0.9, assigned_to: 0.8, location: 0.7 },
    };
    expect(shouldFinalize(result, 'daily_task')).toBe(true);
  });

  test('shouldFinalize returns false when required fields are missing', () => {
    const result = {
      known_fields: { task_goal: 'Pull cable' },
      confidence_by_field: { task_goal: 0.9 },
    };
    expect(shouldFinalize(result, 'daily_task')).toBe(false);
  });

  test('shouldFinalize returns false when confidence is too low', () => {
    const result = {
      known_fields: { task_goal: 'Pull cable', assigned_to: 'someone', location: 'somewhere' },
      confidence_by_field: { task_goal: 0.9, assigned_to: 0.3, location: 0.2 },
    };
    expect(shouldFinalize(result, 'daily_task')).toBe(false);
  });

  test('shouldFinalize handles null/undefined gracefully', () => {
    expect(shouldFinalize(null, 'daily_task')).toBe(false);
    expect(shouldFinalize({}, 'daily_task')).toBe(false);
    expect(shouldFinalize({ known_fields: {} }, 'daily_task')).toBe(false);
  });

  test('getNextPriorityField returns highest priority missing field', () => {
    const result = {
      known_fields: { task_goal: 'Pull cable' },
      confidence_by_field: { task_goal: 0.9 },
    };
    const next = getNextPriorityField(result, 'daily_task');
    expect(next).toBeDefined();
    expect(next.field).toBe('assigned_to'); // second required field
    expect(next.priority).toBe('required');
  });

  test('getNextPriorityField returns important field when all required are known', () => {
    const result = {
      known_fields: { task_goal: 'Pull cable', assigned_to: 'Miguel', location: 'Rack 5A' },
      confidence_by_field: { task_goal: 0.9, assigned_to: 0.8, location: 0.7 },
    };
    const next = getNextPriorityField(result, 'daily_task');
    expect(next).toBeDefined();
    expect(next.priority).toBe('important');
  });

  test('getNextPriorityField returns null when all fields are known', () => {
    const allFields = [...FIELD_SCHEMAS.daily_task.required, ...FIELD_SCHEMAS.daily_task.important, ...FIELD_SCHEMAS.daily_task.optional];
    const known = {};
    const confidence = {};
    for (const f of allFields) { known[f] = 'value'; confidence[f] = 0.9; }
    const next = getNextPriorityField({ known_fields: known, confidence_by_field: confidence }, 'daily_task');
    expect(next).toBeNull();
  });
});

// ============================================================
// Safety Detector
// ============================================================
describe('Safety Detector', () => {
  test('detects common safety terms in English', () => {
    const result = detectSafety('We need to do a lockout tagout before working on the panel');
    expect(result.detected).toBe(true);
    expect(result.terms).toContain('lockout');
  });

  test('detects PPE mentions', () => {
    const result = detectSafety('Make sure everyone has their harness and hard hat');
    expect(result.detected).toBe(true);
    expect(result.terms).toContain('harness');
    expect(result.terms).toContain('hard hat');
  });

  test('detects safety terms in Spanish', () => {
    const result = detectSafety('Necesitamos el arnés y el casco para trabajar arriba');
    expect(result.detected).toBe(true);
    expect(result.terms).toContain('arnés');
    expect(result.terms).toContain('casco');
  });

  test('detects incident-related terms', () => {
    const result = detectSafety('We had a near miss today when the load shifted');
    expect(result.detected).toBe(true);
    expect(result.terms).toContain('near miss');
  });

  test('returns false for non-safety text', () => {
    const result = detectSafety('Pulled 200 feet of cable through the tray today');
    expect(result.detected).toBe(false);
    expect(result.terms).toHaveLength(0);
  });

  test('handles empty/null input gracefully', () => {
    expect(detectSafety('').detected).toBe(false);
    expect(detectSafety(null).detected).toBe(false);
    expect(detectSafety(undefined).detected).toBe(false);
  });

  test('returns summary string when detected', () => {
    const result = detectSafety('Check the fire extinguisher near the scaffold');
    expect(result.detected).toBe(true);
    expect(result.summary).toContain('Safety keywords detected');
  });

  test('detects arc flash and energized work', () => {
    const result = detectSafety('The panel is still energized, watch for arc flash');
    expect(result.detected).toBe(true);
    expect(result.terms).toContain('energized');
    expect(result.terms).toContain('arc flash');
  });

  test('detects confined space and permits', () => {
    const result = detectSafety('We need a confined space permit for the vessel entry');
    expect(result.detected).toBe(true);
    expect(result.terms).toContain('confined space');
    expect(result.terms).toContain('permit');
  });
});

// ============================================================
// Feedback Capture
// ============================================================
describe('Feedback Capture - computeDiffs', () => {
  test('detects field differences', () => {
    const ai = { fields: { title: 'Pull cable', priority: 'normal' } };
    const final = { fields: { title: 'Pull cable', priority: 'high' } };
    const diffs = computeDiffs(ai, final);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].field).toBe('priority');
    expect(diffs[0].category).toBe('wrong_emphasis');
  });

  test('detects missing details', () => {
    const ai = { fields: { title: 'Fix valve' } };
    const final = { fields: { title: 'Fix valve', location: 'Unit 3 Rack 5' } };
    const diffs = computeDiffs(ai, final);
    expect(diffs.some(d => d.field === 'location' && d.category === 'missing_detail')).toBe(true);
  });

  test('detects assignee corrections', () => {
    const ai = { fields: { assigned_to: 'person_1' } };
    const final = { fields: { assigned_to: 'person_2' } };
    const diffs = computeDiffs(ai, final);
    expect(diffs[0].category).toBe('incorrect_assignee');
  });

  test('returns empty array when no differences', () => {
    const data = { fields: { title: 'Pull cable', priority: 'high' } };
    expect(computeDiffs(data, data)).toHaveLength(0);
  });

  test('handles nested objects gracefully', () => {
    const ai = { title: 'Test', items: ['a', 'b'] };
    const final = { title: 'Test', items: ['a', 'b', 'c'] };
    const diffs = computeDiffs(ai, final);
    expect(diffs.length).toBeGreaterThan(0);
  });
});

// ============================================================
// Refine Prompts — Structured Output
// ============================================================
describe('Refine Prompts', () => {
  const { buildRefinePrompt } = require('../server/services/ai/refinePrompts');

  test('dialogue prompt includes natural output instruction', () => {
    const prompt = buildRefinePrompt('dialogue', 'daily_task', {
      round: 0, personContext: '', safetyContext: '', tradeKnowledge: '',
    });
    expect(prompt).toContain('spoken_response');
    expect(prompt).toContain('ready_to_finalize');
    expect(prompt).toContain('key_points');
    expect(prompt).toContain('safety_flag');
  });

  test('dialogue prompt has natural reasoning guidance', () => {
    const prompt = buildRefinePrompt('dialogue', 'daily_task', {
      round: 0, personContext: '', safetyContext: '', tradeKnowledge: '',
    });
    expect(prompt).toContain('Think about things like');
    expect(prompt).toContain('use your judgment');
  });

  test('dialogue prompt includes response style rules', () => {
    const prompt = buildRefinePrompt('dialogue', 'shift_update', {
      round: 0, personContext: '', safetyContext: '', tradeKnowledge: '',
    });
    expect(prompt).toContain('How to talk');
    expect(prompt).toContain('2-5 sentences');
    expect(prompt).toContain('coworker');
  });

  test('dialogue prompt injects safety detection when present', () => {
    const prompt = buildRefinePrompt('dialogue', 'daily_task', {
      round: 0, personContext: '', safetyContext: '', tradeKnowledge: '',
      safetyDetection: { detected: true, terms: ['harness', 'fall protection'] },
    });
    expect(prompt).toContain('safety-related topics');
    expect(prompt).toContain('harness');
  });

  test('dialogue prompt injects recent reports when present', () => {
    const prompt = buildRefinePrompt('dialogue', 'shift_update', {
      round: 0, personContext: '', safetyContext: '', tradeKnowledge: '',
      recentReports: [{ date: '3/26/2026', summary: 'Pulled 200ft cable in Tray 5A' }],
    });
    expect(prompt).toContain('recent reports');
    expect(prompt).toContain('Pulled 200ft cable');
  });

  test('edit phase prompt exists and has correct instruction', () => {
    const prompt = buildRefinePrompt('edit', 'daily_task', { personContext: '' });
    expect(prompt).toContain('editing a previously finalized');
    expect(prompt).toContain('Apply ONLY the requested change');
    expect(prompt).toContain('what_changed');
  });

  test('finalize prompts are unchanged for all context types', () => {
    for (const type of ['daily_task', 'shift_update', 'punch_list']) {
      const prompt = buildRefinePrompt('finalize', type, {
        personContext: '', teamContext: '', taskContext: {},
      });
      expect(prompt).toContain('finalizing');
      expect(prompt).toContain('Return ONLY valid JSON');
    }
  });

  test('all three context types produce valid dialogue prompts', () => {
    for (const type of ['daily_task', 'shift_update', 'punch_list']) {
      const prompt = buildRefinePrompt('dialogue', type, {
        round: 0, personContext: '', safetyContext: '', tradeKnowledge: '',
      });
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(200);
      expect(prompt).toContain('spoken_response');
    }
  });
});

// ============================================================
// Knowledge Cache
// ============================================================
describe('Knowledge Cache', () => {
  const knowledgeCache = require('../server/services/ai/knowledgeCache');

  test('initializes without error', () => {
    expect(() => knowledgeCache.initialize()).not.toThrow();
  });

  test('stats returns valid object', () => {
    const s = knowledgeCache.stats();
    expect(s).toHaveProperty('size');
    expect(s).toHaveProperty('initialized');
    expect(s).toHaveProperty('keys');
    expect(s.initialized).toBe(true);
  });

  test('keys returns array', () => {
    expect(Array.isArray(knowledgeCache.keys())).toBe(true);
  });

  test('get returns null for non-existent key', () => {
    expect(knowledgeCache.get('non_existent_file_xyz')).toBeNull();
  });
});
