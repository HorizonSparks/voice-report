/**
 * AI Context Loader
 * Loads person context, safety basics, and trade-specific knowledge.
 * Extracted from ai.js for maintainability.
 */
const path = require('path');
const fs = require('fs');
const DB = require('../../../database/db');

const ROOT = path.join(__dirname, '../../..');

/**
 * Load safety basics from safety_basics.json
 */
function loadSafetyBasics() {
  try {
    const safetyPath = path.join(ROOT, 'safety_basics.json');
    if (fs.existsSync(safetyPath)) {
      return JSON.parse(fs.readFileSync(safetyPath, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load safety basics:', e.message);
  }
  return null;
}

/**
 * Load person and template context for AI prompts
 */
async function loadPersonContext(personId, dbOverride) {
  if (!personId) return '';
  try {
    const person = await (dbOverride || DB).people.getById(personId);
    if (!person || !person.template_id) return '';

    const tplPath = path.join(ROOT, 'templates', `${person.template_id}.json`);
    if (!fs.existsSync(tplPath)) return '';

    const template = JSON.parse(fs.readFileSync(tplPath, 'utf8'));
    let context = `\nWorker context: ${person.name}, ${template.template_name} (${template.trade}). ${template.role_description || ''}`;
    if (template.vocabulary && template.vocabulary.terms) {
      context += `\nIndustry vocabulary they may use: ${template.vocabulary.terms.slice(0, 40).join(', ')}`;
    }

    // Load knowledge files for deeper person context
    try {
      const knowledgeRows = (await (dbOverride || DB).db.query(
        "SELECT title, text_content FROM knowledge_files WHERE person_id = $1 AND text_content IS NOT NULL AND text_content != '' ORDER BY created_at DESC LIMIT 3",
        [person.id]
      )).rows;
      if (knowledgeRows.length > 0) {
        let totalChars = 0;
        const maxChars = 4000;
        for (const kf of knowledgeRows) {
          const text = kf.text_content || '';
          if (totalChars + text.length > maxChars) {
            context += `\n\nKnowledge file (${kf.title}, truncated):\n${text.substring(0, maxChars - totalChars)}`;
            break;
          }
          context += `\n\nKnowledge file (${kf.title}):\n${text}`;
          totalChars += text.length;
        }
      }
    } catch (kErr) {
      console.error('Knowledge load in personContext:', kErr.message);
    }

    return context;
  } catch (e) {
    return '';
  }
}

/**
 * Load safety context string for AI follow-ups
 */
function loadSafetyContext() {
  try {
    const safetyPath = path.join(ROOT, 'safety_basics.json');
    if (fs.existsSync(safetyPath)) {
      const safety = JSON.parse(fs.readFileSync(safetyPath, 'utf8'));
      if (safety.rules) {
        return `\nKey safety rules to consider: ${safety.rules.slice(0, 8).map(r => r.rule || r).join('; ')}`;
      }
    }
  } catch (e) {}
  return '';
}

/**
 * Determine trade from person context string
 */
function detectTrade(personContext) {
  if (personContext.includes('Instrumentation')) return 'instrumentation';
  if (personContext.includes('Pipe Fitting')) return 'pipefitting';
  if (personContext.includes('Industrial Erection')) return 'erection';
  if (personContext.includes('Safety')) return 'safety';
  return 'electrical';
}

/**
 * Load trade-specific knowledge files
 */
function loadTradeKnowledge(trade, allText) {
  let tradeKnowledge = '';
  try {
    const knowledgeDir = path.join(ROOT, 'knowledge');
    if (!fs.existsSync(knowledgeDir)) return '';

    const textLower = (allText || '').toLowerCase();

    // Task keyword maps by trade for smart matching
    const taskKeywordsByTrade = {
      instrumentation: {
        instrument_installation: ['instrument', 'transmitter', 'pressure', 'temperature', 'level', 'flow', 'install', 'mount', 'thermowell', 'rtd', 'thermocouple'],
        tubing_runs: ['tubing', 'tube', 'impulse', 'air supply', 'swagelok', 'fitting', 'compression'],
        control_valve_installation: ['valve', 'control valve', 'actuator', 'positioner', 'globe', 'butterfly'],
        calibration: ['calibrate', 'calibration', 'hart', 'range', 'span', 'zero', 'trim', '4-20'],
        loop_testing: ['loop', 'loop test', 'loop check', 'checkout', 'dcs', 'plc', 'signal'],
        hazardous_areas: ['classified', 'div 1', 'div 2', 'explosion', 'intrinsically safe', 'barrier'],
        pneumatic_systems: ['air', 'pneumatic', 'air header', 'regulator', 'filter'],
        working_near_process_piping: ['process', 'piping', 'hot pipe', 'steam', 'cryogenic'],
      },
      electrical: {
        cable_pulling: ['cable', 'pull', 'wire', 'conductor', 'reel'],
        conduit_installation: ['conduit', 'emt', 'rigid', 'raceway', 'bend'],
        terminations: ['terminate', 'termination', 'land', 'landing', 'lug', 'connect', 'breaker', 'panel'],
        testing_megger: ['megger', 'test', 'insulation', 'resistance', 'meg'],
        testing_hipot: ['hipot', 'high pot', 'high potential'],
        panel_mcc_work: ['panel', 'mcc', 'motor control', 'switchgear', 'breaker'],
        cable_tray: ['tray', 'cable tray', 'ladder tray'],
        confined_space: ['confined', 'vault', 'manhole', 'tank'],
        hot_work_near_electrical: ['weld', 'grind', 'cut', 'hot work', 'spark'],
      },
      pipefitting: {
        welding: ['weld', 'welding', 'stick', 'tig', 'gtaw', 'smaw', 'fcaw', '6010', '7018', 'root pass', 'fill pass', 'cap'],
        fitup: ['fit-up', 'fitup', 'fit up', 'alignment', 'hi-lo', 'mismatch', 'tack', 'bevel', 'root gap'],
        flange_boltup: ['flange', 'bolt', 'bolt-up', 'torque', 'gasket', 'spiral wound', 'rtj', 'ring joint', 'stud'],
        hydro_testing: ['hydro', 'hydrostatic', 'pressure test', 'test pack', 'test boundary', 'leak test'],
      },
    };

    // Smart keyword matching
    const tradeKeywords = taskKeywordsByTrade[trade] || {};
    const matchedTasks = [];
    for (const [taskType, keywords] of Object.entries(tradeKeywords)) {
      if (keywords.some(kw => textLower.includes(kw))) {
        matchedTasks.push(taskType);
      }
    }

    // Load safety file for the trade
    const safetyFile = path.join(knowledgeDir, `${trade}_safety.json`);
    if (fs.existsSync(safetyFile)) {
      const safetyData = JSON.parse(fs.readFileSync(safetyFile, 'utf8'));
      if (safetyData.task_specific_hazards && matchedTasks.length > 0) {
        const relevantHazards = matchedTasks
          .filter(t => safetyData.task_specific_hazards[t])
          .map(t => {
            const h = safetyData.task_specific_hazards[t];
            return `${t}: ${h.hazards?.slice(0, 3).join(', ') || ''}`;
          });
        if (relevantHazards.length > 0) {
          tradeKnowledge += `\nRelevant ${trade} safety hazards: ${relevantHazards.join('; ')}`;
        }
      }
    }

    // Load other knowledge files as needed
    const knowledgeFiles = [
      { file: `${trade}_procedures.json`, key: 'procedures' },
      { file: `${trade}_materials_specs.json`, key: 'materials' },
    ];

    for (const { file, key } of knowledgeFiles) {
      const filePath = path.join(knowledgeDir, file);
      if (fs.existsSync(filePath)) {
        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          if (data.summary) tradeKnowledge += `\n${key}: ${data.summary}`;
        } catch {}
      }
    }
  } catch (e) {
    console.error('Knowledge loading error:', e.message);
  }
  return tradeKnowledge;
}

module.exports = {
  loadSafetyBasics,
  loadPersonContext,
  loadSafetyContext,
  detectTrade,
  loadTradeKnowledge,
};
