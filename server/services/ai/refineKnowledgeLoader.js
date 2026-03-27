/**
 * Refine Knowledge Loader
 * Smart, keyword-driven loading of trade-specific knowledge files.
 * Extracted from ai.js /refine route for maintainability.
 *
 * This is the most detailed knowledge loader — it matches transcript content
 * against trade-specific task keywords to load only relevant safety, procedures,
 * materials, and commissioning data.
 */
const path = require('path');
const fs = require('fs');
const knowledgeCache = require('./knowledgeCache');

const ROOT = path.join(__dirname, '../../..');
const KNOWLEDGE_DIR = path.join(ROOT, 'knowledge');

// Task keyword maps — externalized to JSON config for maintainability
const TASK_KEYWORDS = require('../../config/task-keywords.json');


function readJsonSafe(filePath) {
  // Try cache first (key = filename without extension)
  const key = path.basename(filePath, '.json');
  const cached = knowledgeCache.get(key);
  if (cached) return cached;

  // Fallback to disk
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {}
  return null;
}

/**
 * Load trade-specific knowledge based on transcript keywords
 * @param {string} trade - Trade identifier
 * @param {string} allText - Combined transcript + conversation text
 * @returns {string} Knowledge context string for prompt injection
 */
function loadRefineKnowledge(trade, allText) {
  if (!fs.existsSync(KNOWLEDGE_DIR)) return '';

  let knowledge = '';
  const textLower = (allText || '').toLowerCase();

  // 1. Safety knowledge — keyword-matched task hazards
  const safetyData = readJsonSafe(path.join(KNOWLEDGE_DIR, `${trade}_safety.json`));
  if (safetyData) {
    const taskKeywords = TASK_KEYWORDS[trade] || TASK_KEYWORDS.electrical;
    const taskMatches = [];
    for (const [task, keywords] of Object.entries(taskKeywords)) {
      if (keywords.some(kw => textLower.includes(kw)) && safetyData.tasks && safetyData.tasks[task]) {
        const td = safetyData.tasks[task];
        const summary = [];
        if (td.ppe) summary.push(`PPE: ${td.ppe.join(', ')}`);
        if (td.jsa_items) summary.push(`JSA items: ${td.jsa_items.slice(0, 4).join('; ')}`);
        if (td.permits) summary.push(`Permits needed: ${td.permits.join(', ')}`);
        if (td.hazards) summary.push(`Key hazards: ${td.hazards.slice(0, 3).join('; ')}`);
        if (td.safety) summary.push(`Safety: ${td.safety.slice(0, 3).join('; ')}`);
        if (td.requirements) summary.push(`Requirements: ${(Array.isArray(td.requirements) ? td.requirements : []).slice(0, 3).join('; ')}`);
        taskMatches.push(`[${task.replace(/_/g, ' ')}] ${summary.join('. ')}`);
      }
    }
    if (taskMatches.length > 0) knowledge += `\nRelevant safety knowledge for this work:\n${taskMatches.join('\n')}`;
  }

  // 2. Procedures — punch list items
  const procData = readJsonSafe(path.join(KNOWLEDGE_DIR, `${trade}_procedures.json`));
  if (procData && textLower.includes('punch') && procData.quality_common_punch_items) {
    knowledge += `\nCommon punch list items to watch for: ${procData.quality_common_punch_items.slice(0, 6).join('; ')}`;
  }

  // 3. Materials knowledge
  const matKeywords = ['cable', 'wire', 'conduit', 'emt', 'rigid', 'pvc', 'tubing', 'material', 'fitting', 'seal', 'gasket', 'thhn', 'xhhw', 'mc cable'];
  if (matKeywords.some(kw => textLower.includes(kw))) {
    const matData = readJsonSafe(path.join(KNOWLEDGE_DIR, 'materials_specs.json'));
    if (matData) {
      if (textLower.includes('cable') || textLower.includes('wire')) {
        const cableTypes = Object.entries(matData.cable_types || {}).slice(0, 3).map(([k, v]) => `${k}: ${v.use || v.rating || ''}`).join('; ');
        knowledge += `\nCable type knowledge: ${cableTypes}`;
      }
      if (matData.common_material_mistakes) knowledge += `\nCommon material mistakes: ${matData.common_material_mistakes.slice(0, 3).join('; ')}`;
    }
  }

  // 4. Commissioning knowledge
  if (['energize', 'startup', 'commission', 'pre-energization', 'bump test', 'checkout'].some(kw => textLower.includes(kw))) {
    const commData = readJsonSafe(path.join(KNOWLEDGE_DIR, 'commissioning.json'));
    if (commData?.common_commissioning_mistakes) knowledge += `\nCommon commissioning mistakes to avoid: ${commData.common_commissioning_mistakes.slice(0, 4).join('; ')}`;
  }

  // 5. Lessons learned
  if (['rework', 'mistake', 'problem', 'wrong', 'issue', 'deficiency', 'quality'].some(kw => textLower.includes(kw))) {
    const lessonsData = readJsonSafe(path.join(KNOWLEDGE_DIR, 'lessons_learned.json'));
    if (lessonsData) {
      const reworkKey = `top_rework_causes_${trade === 'pipefitting' ? 'pipefitting' : trade === 'erection' ? 'erection' : trade === 'instrumentation' ? 'instrumentation' : 'electrical'}`;
      if (lessonsData[reworkKey]) knowledge += `\nTop rework causes: ${lessonsData[reworkKey].slice(0, 3).map(r => r.cause).join('; ')}`;
    }
  }

  // 6. Crew/productivity
  if (['crew', 'manpower', 'how many', 'how long', 'productivity', 'schedule', 'coordinate'].some(kw => textLower.includes(kw))) {
    const crewData = readJsonSafe(path.join(KNOWLEDGE_DIR, 'crew_productivity.json'));
    if (crewData?.crew_sizes) knowledge += `\nCrew size reference available for task planning`;
  }

  // 7. Weather/environmental
  if (['weather', 'cold', 'heat', 'rain', 'wind', 'humidity', 'freeze', 'hot'].some(kw => textLower.includes(kw))) {
    readJsonSafe(path.join(KNOWLEDGE_DIR, 'weather_environmental.json')); // verify file exists
    if (textLower.includes('cold') || textLower.includes('freeze')) knowledge += `\nCold weather limits: Cable pulling min temp varies by type (PVC: 14F, XLPE: -40F). Concrete min 50F.`;
    if (textLower.includes('heat') || textLower.includes('hot')) knowledge += `\nHeat stress: Water every 30 min above 80F WBGT. 15 min rest/hr above 85F. Consider stopping above 90F.`;
  }

  // 8. Pipe fitting materials
  const pipeMatKeywords = ['pipe', 'flange', 'gasket', 'bolt', 'stud', 'valve', 'elbow', 'tee', 'reducer', 'spool', 'schedule', 'carbon steel', 'stainless', 'chrome', 'alloy', 'weld neck', 'slip-on'];
  if ((trade === 'pipefitting' || trade === 'erection') && pipeMatKeywords.some(kw => textLower.includes(kw))) {
    const pipeMatData = readJsonSafe(path.join(KNOWLEDGE_DIR, 'pipefitting_materials.json'));
    if (pipeMatData) {
      if (textLower.includes('flange') || textLower.includes('gasket') || textLower.includes('bolt')) knowledge += `\nPipe fitting material knowledge available for flanges, gaskets, and bolt specifications.`;
      if (textLower.includes('torque')) knowledge += `\nBolt torque knowledge available — ask about specific flange size and class.`;
    }
  }

  // 9. Rigging/crane
  const riggingKeywords = ['rig', 'rigging', 'crane', 'lift', 'sling', 'shackle', 'spreader', 'vessel', 'column', 'exchanger', 'module', 'steel', 'erection', 'iron'];
  if (trade === 'erection' || riggingKeywords.some(kw => textLower.includes(kw))) {
    const riggingData = readJsonSafe(path.join(KNOWLEDGE_DIR, 'rigging_crane_operations.json'));
    if (riggingData?.sling_capacities || riggingData?.crane_signals) knowledge += `\nRigging and crane operations knowledge available — sling capacities, crane signals, lift planning.`;
  }

  // 10. Safety department knowledge
  if (trade === 'safety') {
    const safetyDeptData = readJsonSafe(path.join(KNOWLEDGE_DIR, 'safety_department.json'));
    if (safetyDeptData) {
      if (safetyDeptData.voice_assistant_quick_reference) {
        const qr = safetyDeptData.voice_assistant_quick_reference;
        const refs = Object.entries(qr).slice(0, 10).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join('; ');
        knowledge += `\nSafety quick reference: ${refs}`;
      }
      if (textLower.includes('permit')) knowledge += `\nPermit system knowledge available — hot work, confined space, excavation, line break, LOTO.`;
      if (textLower.includes('incident') || textLower.includes('investigation')) knowledge += `\nIncident investigation knowledge: 5 Whys, fishbone, OSHA recordability criteria, reporting deadlines.`;
      if (textLower.includes('trir') || textLower.includes('metric') || textLower.includes('rate')) knowledge += `\nSafety metrics: TRIR formula (recordables x 200,000 / hours worked). Excellent <0.5, world class <0.3.`;
      if (textLower.includes('training') || textLower.includes('osha')) knowledge += `\nTraining requirements knowledge available — OSHA 10/30, fall protection, confined space, crane, forklift, first aid.`;
      if (textLower.includes('jsa') || textLower.includes('jha') || textLower.includes('hazard')) knowledge += `\nJSA/JHA creation knowledge: hazard categories, risk matrix, hierarchy of controls, task-specific templates.`;
    }
  }

  // 11. Piping codes/standards
  if (['asme', 'b31', 'code', 'wps', 'pqr', 'welder qualification', 'section ix', 'aws'].some(kw => textLower.includes(kw))) {
    if (readJsonSafe(path.join(KNOWLEDGE_DIR, 'pipefitting_codes_standards.json'))) {
      knowledge += `\nPiping codes and standards knowledge available — ASME B31.3, B31.1, Section IX, welding qualifications.`;
    }
  }

  return knowledge;
}

module.exports = { TASK_KEYWORDS, loadRefineKnowledge };
