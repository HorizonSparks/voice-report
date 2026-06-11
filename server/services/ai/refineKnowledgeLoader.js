/**
 * Refine Knowledge Loader
 * Smart, keyword-driven loading of trade-specific knowledge files.
 * Extracted from ai.js /refine route for maintainability.
 *
 * This is the most detailed knowledge loader — it matches transcript content
 * against trade-specific task keywords to load only relevant safety, procedures,
 * materials, and commissioning data.
 *
 * ARCHITECTURE: The AI never sees all 326KB at once. This loader acts as a librarian —
 * it pulls only the relevant pages from the right books based on what the worker is
 * talking about. Typically 2-5KB of targeted knowledge per conversation turn.
 */
const path = require('path');
const fs = require('fs');
const knowledgeCache = require('./knowledgeCache');

const ROOT = path.join(__dirname, '../../..');
const KNOWLEDGE_DIR = path.join(ROOT, 'knowledge');

// Task keyword maps — externalized to JSON config for maintainability
const TASK_KEYWORDS = require('../../config/task-keywords.json');

// ═══════════════════════════════════════════════════════════════════
// KNOWLEDGE SCHEMA CONTRACT (2026-06-11, task #45)
//
// The loader serves SIX trades whose JSON files were written by different
// hands with different key shapes. The old loader hardcoded ~70 exact key
// names that only instrumentation satisfied — pipefitting (156KB), erection
// (51KB), millwright (76KB), safety (152KB) and most of electrical were
// silently unreachable (~500KB dark). These helpers define the contract:
//
//   safety:   {tasks: {...}} | {safety_by_task: {...}} | topical top-level
//             sections (fall_protection, LOTO_rotating_equipment, …).
//             Entry fields are alias-tolerant (ppe/PPE, permits/
//             permits_required, jsa_items/JSA_items, …).
//   sections: task-keyword → section-key resolution is TOKEN-based
//             (megger_testing ↔ testing_megger, flange_boltup ↔
//             flange_bolt_up, hydro_testing ↔ hydrostatic_testing_procedure)
//             — never exact-string-only again.
//   codes:    {trade}_codes_standards.json OR {trade}_codes.json; named
//             lookups resolve via normalized prefixes (isa_5_1 ↔
//             ISA_5_1_P_and_ID_symbols) + a generic relevance pass.
//
// The contract is PROVEN by server/scripts/probe-trade-knowledge.js —
// per trade, a synthetic transcript built from that trade's own
// task-keywords must yield non-empty safety + content sections. Run it
// after ANY change to this file or to knowledge/*.json.
// ═══════════════════════════════════════════════════════════════════

const META_KEYS = new Set([
  'trade', 'category', 'description', 'id', 'title', 'version', 'updated_at',
  'disclaimer', 'universal_safety_reminders',
]);

// Tokens too generic to carry meaning when matching key names.
const STOP_TOKENS = new Set([
  'and', 'the', 'of', 'for', 'with', 'a', 'to', 'in', 'on',
  'procedure', 'procedures', 'operation', 'operations', 'section',
  'detail', 'details', 'general', 'common',
]);

// Soft ceiling — gates the GENERIC passes only (checked before each generic
// append). The named instrumentation blocks pre-date the cap and stay
// keyword-gated, not size-gated, so a deliberately keyword-stuffed
// instrumentation transcript can still exceed this (real turns hit 2-6KB).
// Honest scope per Codex review: this cap bounds what task #45 ADDED, it is
// not a global output limit.
const MAX_KNOWLEDGE_CHARS = 7000;

const normKeyChars = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function keyTokens(s) {
  return String(s || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP_TOKENS.has(t))
    .map((t) => (t.length > 4 ? t.replace(/s$/, '') : t)); // light plural stem
}

// Two tokens are equivalent when equal or one prefixes the other
// (hydro ↔ hydrostatic, termination ↔ terminations).
function tokensEquivalent(a, b) {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4) return a.startsWith(b) || b.startsWith(a);
  return false;
}

/**
 * Score how well a task keyword key matches a knowledge-section key.
 * 1.0   = same after separator/case normalization (flange_boltup ↔ flange_bolt_up)
 * ≥0.75 = token-subset either way (fitup ⊂ pipe_fitup_and_alignment,
 *         megger_testing ↔ testing_megger)
 * else  = Jaccard overlap of token sets (conduit_installation ↔
 *         conduit_bending = 0.33)
 */
function keyMatchScore(taskKey, sectionKey) {
  if (normKeyChars(taskKey) === normKeyChars(sectionKey)) return 1;
  const ta = keyTokens(taskKey);
  const tb = keyTokens(sectionKey);
  if (ta.length === 0 || tb.length === 0) return 0;
  let inter = 0;
  for (const x of ta) if (tb.some((y) => tokensEquivalent(x, y))) inter += 1;
  if (inter === 0) return 0;
  const union = ta.length + tb.length - inter;
  const jaccard = union > 0 ? inter / union : 0;
  const aInB = ta.every((x) => tb.some((y) => tokensEquivalent(x, y)));
  const bInA = tb.every((y) => ta.some((x) => tokensEquivalent(x, y)));
  if (aInB || bInA) return Math.max(0.75, jaccard);
  return jaccard;
}

// Field-vocabulary synonyms: workers say the spoken word, files key the
// formal one. Consulted when scoring a section against the transcript —
// REQUIRED for safety-correct tie-breaks among sibling sections (a "tig"
// transcript must select welding_GTAW, never welding_SMAW). Seed list;
// extend as trades surface new vocabulary.
const SECTION_TEXT_HINTS = {
  gtaw: ['tig'],
  smaw: ['stick', '6010', '7018'],
  fcaw: ['flux'],
  loto: ['lockout', 'tagout', 'locked out', 'tagged out'],
  megger: ['insulation resistance'],
  hydrostatic: ['hydro'],
};

/** How strongly does this section key's name appear in the transcript? */
function sectionTextEvidence(sectionKey, textLower) {
  let score = 0;
  for (const t of keyTokens(sectionKey)) {
    if (/^\d+$/.test(t)) continue;
    if (textLower.includes(t)) score += 2;
    else if (t.length > 5 && textLower.includes(t.slice(0, 5))) score += 1;
    const hints = SECTION_TEXT_HINTS[t];
    if (hints && hints.some((h) => textLower.includes(h))) score += 2;
  }
  return score;
}

/** Does this section key's name appear in the transcript text? */
function sectionNameInText(sectionKey, textLower) {
  return sectionTextEvidence(sectionKey, textLower) > 0;
}

/**
 * Resolve a task keyword to the best-matching section of a knowledge file.
 * Strong matches (≥ minStrong) always win. Weak matches (≥ minWeak) are
 * accepted only when the section's own name also appears in the transcript
 * — guards against cross-task bleed (cable_tray must not pull
 * cable_pulling's steps unless the text actually talks about pulling/cable).
 */
function resolveSection(container, taskKey, textLower = '', minStrong = 0.5, minWeak = 0.3) {
  if (!container || typeof container !== 'object') return null;
  // Collect ALL candidates so near-ties resolve on transcript evidence, not
  // key order (Codex MAJOR-1: pipefitting task 'welding' scores welding_SMAW
  // / welding_GTAW / welding_FCAW identically — a "tig" transcript must get
  // GTAW, never whichever key happens to come first in the JSON).
  const candidates = [];
  for (const k of Object.keys(container)) {
    if (META_KEYS.has(k)) continue;
    const s = keyMatchScore(taskKey, k);
    if (s > 0) candidates.push({ key: k, score: s });
  }
  if (candidates.length === 0) return null;
  const topScore = Math.max(...candidates.map((c) => c.score));
  const tied = candidates.filter((c) => c.score >= topScore - 0.1);
  let best = tied[0];
  if (tied.length > 1 && textLower) {
    let bestEvidence = -1;
    for (const c of tied) {
      const ev = sectionTextEvidence(c.key, textLower);
      if (ev > bestEvidence) {
        bestEvidence = ev;
        best = c;
      }
    }
  }
  if (best.score >= minStrong) return { key: best.key, data: container[best.key], score: best.score };
  if (best.score >= minWeak && textLower && sectionNameInText(best.key, textLower)) {
    return { key: best.key, data: container[best.key], score: best.score };
  }
  return null;
}

/**
 * Generic relevance pass: sections of a knowledge file whose names appear
 * in the transcript (or match active task keywords), best-scored first.
 * This is what lights up the files the named blocks don't know about —
 * electrical_materials.wire_and_cable, erection_codes.AISC,
 * safety_department.section_03_incident_investigation, …
 */
function findRelevantSections(data, textLower, activeKeywords = [], maxSections = 3) {
  if (!data || typeof data !== 'object') return [];
  const scored = [];
  for (const [sectionKey, sectionData] of Object.entries(data)) {
    if (META_KEYS.has(sectionKey)) continue;
    const toks = keyTokens(sectionKey);
    let score = 0;
    for (const t of toks) {
      if (/^\d+$/.test(t)) continue;
      if (textLower.includes(t)) score += 2;
      else if (t.length > 5 && textLower.includes(t.slice(0, 5))) score += 1;
    }
    for (const kw of activeKeywords) {
      if (toks.some((t) => tokensEquivalent(t, kw))) score += 1;
    }
    if (score > 0) scored.push({ key: sectionKey, data: sectionData, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxSections);
}

/**
 * Boundary-aware task-keyword activation (Codex re-review MAJOR-1): short
 * single-word keywords ('rig', 'set', 'key', 'jaw', 'trip') must not
 * substring-activate inside unrelated words — 'rig' was activating on
 * "RIGID conduit" and pulling crane/rigging safety into electrical-style
 * millwright turns. Word-boundary match with common inflections allowed
 * (rig→rigs/rigging, set→setting, align→alignment, trip→tripped). Phrases
 * and longer words keep plain substring — they're specific enough and
 * substring is what lets 'termination' cover 'terminations'.
 */
function keywordInText(kw, textLower) {
  const k = String(kw).toLowerCase().trim();
  if (!k) return false;
  if (k.includes(' ') || k.length >= 6) return textLower.includes(k);
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lastChar = esc.slice(-1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Full keyword + optional doubled final consonant + common suffix
  // (rig→rigs/rigging, set→setting, trip→tripped, align→alignment).
  let core = `${esc}(?:${lastChar})?(?:s|es|ed|ing|ment)?`;
  // Silent-e drop (Codex follow-up MAJOR): wire→wiring, cable→cabling,
  // probe→probing, guide→guiding — the e disappears before ing/ed.
  // 'ation' is deliberately NOT allowed: probe+ation would match
  // "probation" (Codex final-round catch).
  if (k.endsWith('e')) {
    const stem = esc.slice(0, -1);
    core = `(?:${core}|${stem}(?:ing|ed))`;
  }
  const re = new RegExp(`(^|[^a-z0-9])${core}([^a-z0-9]|$)`);
  return re.test(textLower);
}

// Alias-tolerant safety entry formatter. Handles tasks-shape entries
// (ppe/jsa_items/permits/hazards), pipefitting's safety_by_task shape
// (PPE/JSA_items/permits_required/fire_watch_requirements) and free-form
// topical sections (erection fall_protection, millwright LOTO_*) — the
// last via extractSummary.
// Labels carry the "Safety — " prefix so safety entries are structurally
// distinguishable from content sections — both for the model (provenance)
// and for the reachability probe's accounting (Codex MAJOR-3).
function formatSafetyEntry(label, td) {
  if (td == null) return '';
  if (typeof td !== 'object') return `[Safety — ${label}] ${String(td).substring(0, 300)}`;
  const lower = {};
  for (const [k, v] of Object.entries(td)) lower[k.toLowerCase()] = v;
  const asArr = (v) =>
    Array.isArray(v)
      ? v
      : typeof v === 'string'
        ? [v]
        : Object.values(v).map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
  const pick = (...names) => {
    for (const n of names) if (lower[n] != null) return lower[n];
    return null;
  };
  const summary = [];
  const ppe = pick('ppe');
  if (ppe) summary.push(`PPE: ${asArr(ppe).slice(0, 6).join(', ')}`);
  const jsa = pick('jsa_items');
  if (jsa) summary.push(`JSA items: ${asArr(jsa).slice(0, 4).join('; ')}`);
  const permits = pick('permits', 'permits_required');
  if (permits) summary.push(`Permits needed: ${asArr(permits).slice(0, 4).join(', ')}`);
  const hazards = pick('hazards');
  if (hazards) summary.push(`Key hazards: ${asArr(hazards).slice(0, 3).join('; ')}`);
  const safety = pick('safety');
  if (safety) summary.push(`Safety: ${asArr(safety).slice(0, 4).join('; ')}`);
  const reqs = pick('requirements', 'osha_requirement', 'osha_requirements');
  if (reqs) summary.push(`Requirements: ${asArr(reqs).slice(0, 3).join('; ')}`);
  const fire = pick('fire_watch_requirements');
  if (fire) summary.push(`Fire watch: ${asArr(fire).slice(0, 2).join('; ')}`);
  if (summary.length === 0) return `[Safety — ${label}] ${extractSummary(td, 5, 500)}`;
  return `[Safety — ${label}] ${summary.join('. ')}`;
}


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
 * Extract a concise summary from a JSON object for prompt injection.
 * Handles arrays (join first N items), objects (recursive), and primitives.
 * Keeps output under maxChars to prevent prompt bloat.
 */
function extractSummary(obj, maxItems = 5, maxChars = 1500) {
  if (!obj) return '';
  if (typeof obj === 'string') return obj.substring(0, maxChars);
  if (Array.isArray(obj)) return obj.slice(0, maxItems).join('; ').substring(0, maxChars);
  if (typeof obj === 'object') {
    const parts = [];
    for (const [k, v] of Object.entries(obj)) {
      if (parts.join('; ').length > maxChars) break;
      const key = k.replace(/_/g, ' ');
      if (typeof v === 'string') parts.push(`${key}: ${v}`);
      else if (Array.isArray(v)) parts.push(`${key}: ${v.slice(0, 3).join(', ')}`);
      else if (typeof v === 'object' && v !== null) {
        // One level deep for nested objects
        const sub = Object.entries(v).slice(0, 3).map(([sk, sv]) =>
          typeof sv === 'string' ? `${sk.replace(/_/g, ' ')}: ${sv}` : sk.replace(/_/g, ' ')
        ).join(', ');
        parts.push(`${key} — ${sub}`);
      }
    }
    return parts.join('. ').substring(0, maxChars);
  }
  return String(obj);
}

/**
 * Find matching sections in a knowledge file based on keywords.
 * Returns the actual content (not just "knowledge available").
 */
function findMatchingSections(data, textLower, keywords, maxSections = 3) {
  if (!data || typeof data !== 'object') return [];
  const matches = [];

  for (const [sectionKey, sectionData] of Object.entries(data)) {
    // Skip metadata fields
    if (['trade', 'category', 'description'].includes(sectionKey)) continue;

    // Check if any keyword matches this section key or the text mentions it
    const sectionName = sectionKey.toLowerCase().replace(/_/g, ' ');
    const isRelevant = keywords.some(kw => textLower.includes(kw)) ||
                       textLower.includes(sectionName);

    if (isRelevant && matches.length < maxSections) {
      matches.push({ key: sectionKey, data: sectionData });
    }
  }
  return matches;
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
  const taskKeywords = TASK_KEYWORDS[trade] || TASK_KEYWORDS.electrical;

  // ═══════════════════════════════════════════════════════════
  // 1. SAFETY KNOWLEDGE — keyword-matched task hazards
  //    Source: {trade}_safety.json
  //    Always loaded first — safety is #1 priority
  // ═══════════════════════════════════════════════════════════
  // The safety-department trade has no safety_safety.json — its corpus is
  // safety_department.json (section_01_osha_regulations … section_08_site_
  // safety_programs), which the topical branch below matches per task
  // (permits → section_02_permit_systems, incidents → section_03_incident_
  // investigation, training → section_07_training_requirements, …).
  const safetyData =
    readJsonSafe(path.join(KNOWLEDGE_DIR, `${trade}_safety.json`)) ||
    (trade === 'safety' ? readJsonSafe(path.join(KNOWLEDGE_DIR, 'safety_department.json')) : null);
  // Active tasks = keyword hit in transcript. Computed once, reused by the
  // safety + procedures + generic passes below.
  const activeTasks = Object.entries(taskKeywords)
    .filter(([, keywords]) => keywords.some((kw) => keywordInText(kw, textLower)))
    .map(([task]) => task);
  // Flat keyword list of the active tasks — fed to the generic relevance pass.
  const activeKeywordTokens = activeTasks
    .flatMap((task) => keyTokens(task).concat((taskKeywords[task] || []).flatMap(keyTokens)))
    .filter((t, i, a) => a.indexOf(t) === i);
  if (safetyData) {
    // Three accepted shapes (see schema contract above):
    //   tasks-keyed (electrical, instrumentation), safety_by_task-keyed
    //   (pipefitting), or topical top-level sections (erection, millwright).
    const container =
      safetyData.tasks && typeof safetyData.tasks === 'object'
        ? safetyData.tasks
        : safetyData.safety_by_task && typeof safetyData.safety_by_task === 'object'
          ? safetyData.safety_by_task
          : null;
    const taskMatches = [];
    const usedKeys = new Set();
    if (container) {
      for (const task of activeTasks) {
        const hit = resolveSection(container, task, textLower, 0.45);
        if (hit && !usedKeys.has(hit.key)) {
          usedKeys.add(hit.key);
          const line = formatSafetyEntry(hit.key.replace(/_/g, ' '), hit.data);
          if (line) taskMatches.push(line);
        }
      }
    } else {
      // Topical safety file: resolve active tasks against the top-level
      // sections, then let transcript relevance pull in what task names
      // missed (a millwright saying "locked out the pump" reaches
      // LOTO_rotating_equipment through 'rotating'/'pump' tokens in text).
      for (const task of activeTasks) {
        const hit = resolveSection(safetyData, task, textLower, 0.45);
        if (hit && !usedKeys.has(hit.key)) {
          usedKeys.add(hit.key);
          const line = formatSafetyEntry(hit.key.replace(/_/g, ' '), hit.data);
          if (line) taskMatches.push(line);
        }
      }
      for (const sec of findRelevantSections(safetyData, textLower, activeKeywordTokens, 2)) {
        if (!usedKeys.has(sec.key) && taskMatches.length < 4) {
          usedKeys.add(sec.key);
          const line = formatSafetyEntry(sec.key.replace(/_/g, ' '), sec.data);
          if (line) taskMatches.push(line);
        }
      }
    }
    if (taskMatches.length > 0) knowledge += `\nRelevant safety knowledge for this work:\n${taskMatches.join('\n')}`;
  }

  // ═══════════════════════════════════════════════════════════
  // 2. PROCEDURES — task-specific steps and common mistakes
  //    Source: {trade}_procedures.json
  //    Injects actual procedure steps, not just availability
  // ═══════════════════════════════════════════════════════════
  const procData = readJsonSafe(path.join(KNOWLEDGE_DIR, `${trade}_procedures.json`));
  if (procData) {
    // Punch list items
    if (textLower.includes('punch') && procData.quality_common_punch_items) {
      knowledge += `\nCommon punch list items to watch for: ${procData.quality_common_punch_items.slice(0, 8).join('; ')}`;
    }

    // Match specific procedure sections based on keywords — token-based
    // resolution (task #45): flange_boltup ↔ flange_bolt_up, testing_megger ↔
    // megger_testing, hydro_testing ↔ hydrostatic_testing_procedure, fitup ⊂
    // pipe_fitup_and_alignment all land now. Sections without .steps (e.g.
    // erection equipment_setting's nested vessels/exchangers/columns) inject
    // a summary instead of silently yielding nothing.
    const usedProcKeys = new Set();
    for (const task of activeTasks) {
      const hit = resolveSection(procData, task, textLower);
      if (!hit || usedProcKeys.has(hit.key)) continue;
      usedProcKeys.add(hit.key);
      const section = hit.data;
      if (!section || typeof section !== 'object') continue;
      let injected = false;
      if (section.steps) {
        knowledge += `\n[${task.replace(/_/g, ' ')} procedure] Steps: ${section.steps.slice(0, 5).join('; ')}`;
        injected = true;
      }
      if (section.common_mistakes) {
        knowledge += `\nCommon mistakes: ${(Array.isArray(section.common_mistakes) ? section.common_mistakes : Object.values(section.common_mistakes)).slice(0, 3).join('; ')}`;
        injected = true;
      }
      if (section.common_errors) {
        knowledge += `\nCommon errors: ${section.common_errors.slice(0, 3).join('; ')}`;
        injected = true;
      }
      if (!injected) {
        knowledge += `\n[${task.replace(/_/g, ' ')} — ${hit.key.replace(/_/g, ' ')}] ${extractSummary(section, 4, 450)}`;
      }
    }

    // Transmitter installation — deep procedures
    if (procData.transmitter_installation) {
      const ti = procData.transmitter_installation;
      if (textLower.includes('dp') || textLower.includes('differential') || textLower.includes('dp transmitter')) {
        if (ti.dp_transmitter) {
          knowledge += `\n[DP transmitter installation] ${ti.dp_transmitter.steps ? 'Steps: ' + ti.dp_transmitter.steps.slice(0, 5).join('; ') : ''}`;
          if (ti.dp_transmitter.common_mistakes) knowledge += `\nCommon DP mistakes: ${ti.dp_transmitter.common_mistakes.slice(0, 3).join('; ')}`;
        }
      }
      if (textLower.includes('pressure transmitter') || (textLower.includes('pressure') && textLower.includes('install'))) {
        if (ti.pressure_transmitter?.steps) knowledge += `\n[Pressure transmitter] ${ti.pressure_transmitter.steps.slice(0, 4).join('; ')}`;
      }
      if (textLower.includes('temperature') || textLower.includes('thermowell') || textLower.includes('rtd') || textLower.includes('thermocouple')) {
        if (ti.temperature_transmitter) {
          knowledge += `\n[Temperature installation] ${ti.temperature_transmitter.thermowell_first || ''}`;
          if (ti.temperature_transmitter.tc_rules) knowledge += `\nTC rules: ${ti.temperature_transmitter.tc_rules.slice(0, 3).join('; ')}`;
          if (ti.temperature_transmitter.rtd_rules) knowledge += `\nRTD rules: ${ti.temperature_transmitter.rtd_rules.slice(0, 3).join('; ')}`;
        }
      }
      if (textLower.includes('control valve') || textLower.includes('actuator') || textLower.includes('positioner')) {
        if (ti.control_valve_installation) {
          const cv = ti.control_valve_installation;
          if (cv.steps) knowledge += `\n[Control valve installation] Steps: ${cv.steps.slice(0, 5).join('; ')}`;
          if (cv.common_mistakes) knowledge += `\nValve mistakes: ${cv.common_mistakes.slice(0, 3).join('; ')}`;
        }
      }
      if (textLower.includes('orifice') || textLower.includes('flow element')) {
        if (ti.flow_element_orifice) {
          const oe = ti.flow_element_orifice;
          knowledge += `\n[Orifice plate] Orientation: ${oe.orientation || 'Bevel downstream, text upstream'}. ${oe.common_errors ? 'Errors: ' + oe.common_errors.slice(0, 3).join('; ') : ''}`;
        }
      }
    }

    // Manifold procedures
    if (procData.manifold_valve_procedures && (textLower.includes('manifold') || textLower.includes('isolat') || textLower.includes('equali'))) {
      const mv = procData.manifold_valve_procedures;
      if (mv['3_valve_manifold']) {
        knowledge += `\n[3-valve manifold] To isolate: ${mv['3_valve_manifold'].to_isolate?.join('; ') || ''}. CRITICAL: ${mv['3_valve_manifold'].critical_rule || ''}`;
      }
    }

    // HART / Smart transmitter configuration
    if (procData.smart_transmitter_configuration && (textLower.includes('hart') || textLower.includes('fieldbus') || textLower.includes('configure') || textLower.includes('smart'))) {
      const stc = procData.smart_transmitter_configuration;
      if (stc.hart_protocol && textLower.includes('hart')) {
        knowledge += `\n[HART protocol] Requirements: ${stc.hart_protocol.requirements?.slice(0, 3).join('; ') || ''}. Parameters: ${stc.hart_protocol.common_parameters?.slice(0, 5).join(', ') || ''}`;
      }
      if (stc.foundation_fieldbus && textLower.includes('fieldbus')) {
        knowledge += `\n[Foundation Fieldbus] ${stc.foundation_fieldbus.segment_rules?.slice(0, 3).join('; ') || ''}`;
      }
    }

    // Calibration procedures
    if (procData.calibration_procedure && (textLower.includes('calibrat') || textLower.includes('as-found') || textLower.includes('as-left'))) {
      const cal = procData.calibration_procedure;
      if (cal.standard_5_point?.steps) knowledge += `\n[Calibration procedure] ${cal.standard_5_point.steps.slice(0, 5).join('; ')}`;
      if (cal.smart_transmitter_calibration && textLower.includes('smart')) {
        knowledge += `\nSmart cal: Sensor trim adjusts sensor to known reference. Output trim adjusts 4/20mA output.`;
      }
      if (cal.control_valve_calibration && (textLower.includes('valve') || textLower.includes('positioner'))) {
        knowledge += `\n[Valve calibration] ${cal.control_valve_calibration.positioner_calibration?.slice(0, 4).join('; ') || ''}`;
      }
    }

    // Loop testing
    if (procData.loop_testing && (textLower.includes('loop') || textLower.includes('checkout'))) {
      knowledge += `\n[Loop testing] ${procData.loop_testing.two_person_requirement || ''}`;
      if (procData.loop_testing.steps) knowledge += `\nSteps: ${procData.loop_testing.steps.slice(0, 6).join('; ')}`;
      if (procData.loop_testing.common_issues) knowledge += `\nCommon issues: ${procData.loop_testing.common_issues.slice(0, 4).join('; ')}`;
    }

    // Pre-commissioning
    if (procData.pre_commissioning_procedures && (textLower.includes('commission') || textLower.includes('pre-comm') || textLower.includes('startup') || textLower.includes('energiz'))) {
      const pc = procData.pre_commissioning_procedures;
      if (pc.instrument_air_system) knowledge += `\n[Instrument air] Quality: ${pc.instrument_air_system.quality || ''}. Pressure: ${pc.instrument_air_system.pressure || ''}`;
      if (pc.tubing_pressure_test) knowledge += `\n[Tubing test] ${pc.tubing_pressure_test.test_pressure || ''}. Medium: ${pc.tubing_pressure_test.medium || ''}`;
    }

    // Signal reference
    if (procData.signal_reference && (textLower.includes('4-20') || textLower.includes('milliamp') || textLower.includes('signal') || textLower.includes('ma'))) {
      const sr = procData.signal_reference;
      knowledge += `\n[Signal reference] 4-20mA: ${sr.formula || 'mA = 4 + (16 × percent/100)'}. Burnout upscale: ${sr.burnout_upscale || '>21 mA'}. Downscale: ${sr.burnout_downscale || '<3.6 mA'}.`;
    }

    // Impulse line routing
    if (procData.impulse_line_routing && (textLower.includes('impulse') || textLower.includes('tubing') || textLower.includes('slope'))) {
      const ilr = procData.impulse_line_routing;
      knowledge += `\n[Impulse lines] Liquid: ${ilr.liquid_service || ''}. Gas: ${ilr.gas_service || ''}. Steam: ${ilr.steam_service || ''}`;
    }

    // Grounding
    if (procData.grounding_and_bonding && (textLower.includes('ground') || textLower.includes('shield') || textLower.includes('static'))) {
      const gb = procData.grounding_and_bonding;
      knowledge += `\n[Grounding] Shields: ${gb.shield_grounding || 'Ground at ONE end — marshalling cabinet'}. IS: ${gb.intrinsically_safe || ''}`;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 3. TRADE-SPECIFIC MATERIALS — deep instrument knowledge
  //    Source: {trade}_materials.json (NEW for instrumentation)
  //    Injects actual specs, not just "knowledge available"
  // ═══════════════════════════════════════════════════════════
  const tradeMatData = readJsonSafe(path.join(KNOWLEDGE_DIR, `${trade}_materials.json`));
  const matLenBefore = knowledge.length;
  if (tradeMatData) {
    // Tubing
    if (tradeMatData.tubing && (textLower.includes('tubing') || textLower.includes('tube') || textLower.includes('swagelok') || textLower.includes('316'))) {
      const sections = findMatchingSections(tradeMatData.tubing, textLower, ['316', 'stainless', 'copper', 'inconel', 'monel', 'tubing'], 2);
      if (sections.length > 0) knowledge += `\n[Tubing specs] ${sections.map(s => extractSummary(s.data, 4, 400)).join('. ')}`;
      if (tradeMatData.tubing.common_mistakes) knowledge += `\nTubing mistakes: ${extractSummary(tradeMatData.tubing.common_mistakes, 3, 300)}`;
    }

    // Fittings
    if (tradeMatData.fittings && (textLower.includes('fitting') || textLower.includes('swagelok') || textLower.includes('compression') || textLower.includes('ferrule'))) {
      knowledge += `\n[Fittings] ${extractSummary(tradeMatData.fittings, 4, 500)}`;
    }

    // Cable types
    if (tradeMatData.cable_types && (textLower.includes('cable') || textLower.includes('wire') || textLower.includes('thermocouple') || textLower.includes('extension wire'))) {
      if (textLower.includes('intrinsically safe') || textLower.includes(' is ') || textLower.includes('blue')) {
        if (tradeMatData.cable_types.intrinsically_safe) knowledge += `\n[IS cable] ${extractSummary(tradeMatData.cable_types.intrinsically_safe, 4, 400)}`;
      }
      if (textLower.includes('thermocouple') || textLower.includes('extension')) {
        if (tradeMatData.cable_types.thermocouple_extension_wire) knowledge += `\n[TC extension wire] ${extractSummary(tradeMatData.cable_types.thermocouple_extension_wire, 4, 400)}`;
      }
    }

    // Transmitters — brand/model specific
    if (tradeMatData.transmitters && (textLower.includes('transmitter') || textLower.includes('rosemount') || textLower.includes('yokogawa') || textLower.includes('endress'))) {
      const tx = tradeMatData.transmitters;
      if (textLower.includes('pressure') && tx.pressure) knowledge += `\n[Pressure transmitters] ${extractSummary(tx.pressure, 3, 400)}`;
      if (textLower.includes('temperature') && tx.temperature) knowledge += `\n[Temperature transmitters] ${extractSummary(tx.temperature, 3, 400)}`;
      if ((textLower.includes('level') || textLower.includes('radar')) && tx.level) knowledge += `\n[Level transmitters] ${extractSummary(tx.level, 3, 400)}`;
      if (textLower.includes('flow') && tx.flow) knowledge += `\n[Flow transmitters] ${extractSummary(tx.flow, 3, 400)}`;
      if ((textLower.includes('dp') || textLower.includes('differential')) && tx.dp) knowledge += `\n[DP transmitters] ${extractSummary(tx.dp, 3, 400)}`;
    }

    // Control valves — materials and specs
    if (tradeMatData.control_valves && (textLower.includes('valve') || textLower.includes('trim') || textLower.includes('packing') || textLower.includes('actuator'))) {
      knowledge += `\n[Control valve materials] ${extractSummary(tradeMatData.control_valves, 4, 500)}`;
    }

    // Junction boxes
    if (tradeMatData.junction_boxes && (textLower.includes('junction box') || textLower.includes('jb') || textLower.includes('terminal'))) {
      knowledge += `\n[Junction boxes] ${extractSummary(tradeMatData.junction_boxes, 3, 300)}`;
    }

    // Manifolds
    if (tradeMatData.manifolds && (textLower.includes('manifold') || textLower.includes('block') || textLower.includes('bleed'))) {
      knowledge += `\n[Manifolds] ${extractSummary(tradeMatData.manifolds, 3, 400)}`;
    }

    // Heat tracing
    if (tradeMatData.heat_tracing && (textLower.includes('heat trac') || textLower.includes('freeze') || textLower.includes('raychem') || textLower.includes('thermon'))) {
      knowledge += `\n[Heat tracing] ${extractSummary(tradeMatData.heat_tracing, 3, 300)}`;
    }

    // Common material mistakes
    if (tradeMatData.common_material_mistakes) {
      const mistakes = Array.isArray(tradeMatData.common_material_mistakes)
        ? tradeMatData.common_material_mistakes
        : Object.values(tradeMatData.common_material_mistakes);
      knowledge += `\nCommon material mistakes: ${mistakes.slice(0, 3).map(m => typeof m === 'string' ? m : (m.mistake || m.description || JSON.stringify(m))).join('; ')}`;
    }

    // Generic pass (task #45): the named blocks above are instrumentation-
    // shaped. When they injected nothing, light up this trade's own material
    // sections by transcript relevance — electrical wire_and_cable/cable_tray/
    // switchgear_and_breakers, pipefitting flange_ratings/bolt_specifications,
    // erection high_strength_bolts, millwright bearings/couplings/grout…
    if (knowledge.length === matLenBefore && knowledge.length < MAX_KNOWLEDGE_CHARS) {
      const sections = findRelevantSections(tradeMatData, textLower, activeKeywordTokens, 3);
      for (const sec of sections) {
        if (knowledge.length >= MAX_KNOWLEDGE_CHARS) break;
        knowledge += `\n[Materials — ${sec.key.replace(/_/g, ' ')}] ${extractSummary(sec.data, 4, 450)}`;
      }
    }
  }

  // Fallback: generic materials_specs.json (for electrical/general).
  // Task #45 fix: fires when the trade file is MISSING or yielded nothing —
  // the old `if (!tradeMatData)` gate cut electricians off from the cable-
  // type fallback the moment electrical_materials.json appeared on disk.
  if (knowledge.length === matLenBefore) {
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
  }

  // ═══════════════════════════════════════════════════════════
  // 4. QUALITY & INSPECTION — checklists and QA/QC
  //    Source: {trade}_quality_inspection.json (NEW)
  // ═══════════════════════════════════════════════════════════
  const qualData = readJsonSafe(path.join(KNOWLEDGE_DIR, `${trade}_quality_inspection.json`));
  const qualLenBefore = knowledge.length;
  if (qualData) {
    // Installation QC checklists
    if (qualData.installation_qc_checklists && (textLower.includes('install') || textLower.includes('check') || textLower.includes('qc') || textLower.includes('inspect'))) {
      const qc = qualData.installation_qc_checklists;
      if (textLower.includes('transmitter') && qc.transmitter) knowledge += `\n[QC: Transmitter] ${extractSummary(qc.transmitter, 5, 500)}`;
      if (textLower.includes('valve') && qc.control_valve) knowledge += `\n[QC: Control valve] ${extractSummary(qc.control_valve, 5, 500)}`;
      if ((textLower.includes('thermocouple') || textLower.includes('rtd')) && qc.thermocouple_rtd) knowledge += `\n[QC: TC/RTD] ${extractSummary(qc.thermocouple_rtd, 5, 500)}`;
      if (textLower.includes('orifice') && qc.orifice_flow_element) knowledge += `\n[QC: Orifice] ${extractSummary(qc.orifice_flow_element, 5, 500)}`;
      if (textLower.includes('level') && qc.level_instrument) knowledge += `\n[QC: Level] ${extractSummary(qc.level_instrument, 5, 500)}`;
    }

    // Tubing walkdown
    if (qualData.tubing_walkdown_checklist && (textLower.includes('tubing') || textLower.includes('walkdown') || textLower.includes('support'))) {
      knowledge += `\n[Tubing walkdown] ${extractSummary(qualData.tubing_walkdown_checklist, 5, 500)}`;
    }

    // Calibration QA
    if (qualData.calibration_qa_qc && (textLower.includes('calibrat') || textLower.includes('tolerance') || textLower.includes('as-found'))) {
      knowledge += `\n[Calibration QA/QC] ${extractSummary(qualData.calibration_qa_qc, 4, 400)}`;
    }

    // Loop check documentation
    if (qualData.loop_check_documentation && (textLower.includes('loop') || textLower.includes('checkout'))) {
      knowledge += `\n[Loop check docs] ${extractSummary(qualData.loop_check_documentation, 4, 400)}`;
    }

    // ITCC
    if (qualData.itcc_requirements && (textLower.includes('itcc') || textLower.includes('turnover') || textLower.includes('completion'))) {
      knowledge += `\n[ITCC requirements] ${extractSummary(qualData.itcc_requirements, 4, 400)}`;
    }

    // Turnover package
    if (qualData.turnover_package_contents && (textLower.includes('turnover') || textLower.includes('handover') || textLower.includes('package'))) {
      knowledge += `\n[Turnover package] ${extractSummary(qualData.turnover_package_contents, 5, 500)}`;
    }

    // SIS validation
    if (qualData.sis_validation && (textLower.includes('sis') || textLower.includes('sil') || textLower.includes('proof test') || textLower.includes('safety instrumented'))) {
      knowledge += `\n[SIS validation] ${extractSummary(qualData.sis_validation, 4, 500)}`;
    }

    // Generic pass (task #45): non-instrumentation quality files (electrical
    // megger_testing_procedures, pipefitting common_weld_defects_and_causes,
    // erection bolt-tension QC, millwright acceptance criteria) by relevance.
    if (
      knowledge.length === qualLenBefore &&
      knowledge.length < MAX_KNOWLEDGE_CHARS &&
      ['quality', 'inspect', 'qc', 'check', 'punch', 'test', 'reject', 'defect', 'tolerance', 'torque', 'accept'].some((kw) => textLower.includes(kw))
    ) {
      for (const sec of findRelevantSections(qualData, textLower, activeKeywordTokens, 2)) {
        if (knowledge.length >= MAX_KNOWLEDGE_CHARS) break;
        knowledge += `\n[QC — ${sec.key.replace(/_/g, ' ')}] ${extractSummary(sec.data, 4, 450)}`;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 5. TROUBLESHOOTING — diagnostic knowledge
  //    Source: {trade}_troubleshooting.json (NEW)
  // ═══════════════════════════════════════════════════════════
  const troubleData = readJsonSafe(path.join(KNOWLEDGE_DIR, `${trade}_troubleshooting.json`));
  if (troubleData) {
    const troubleKeywords = ['problem', 'issue', 'trouble', 'fault', 'fail', 'not working', 'erratic', 'stuck', 'wrong', 'noise', 'drift', 'error', 'diagnos'];
    const isTroubleshooting = troubleKeywords.some(kw => textLower.includes(kw));
    const troubleLenBefore = knowledge.length;

    if (isTroubleshooting || textLower.includes('troubleshoot')) {
      // Signal issues
      if (troubleData.signal_troubleshooting_4_20mA && (textLower.includes('signal') || textLower.includes('4-20') || textLower.includes('milliamp') || textLower.includes('ma'))) {
        knowledge += `\n[Signal troubleshooting] ${extractSummary(troubleData.signal_troubleshooting_4_20mA, 4, 600)}`;
      }
      // HART issues
      if (troubleData.hart_communication_issues && (textLower.includes('hart') || textLower.includes('communicat'))) {
        knowledge += `\n[HART troubleshooting] ${extractSummary(troubleData.hart_communication_issues, 4, 400)}`;
      }
      // Transmitter diagnostics
      if (troubleData.transmitter_diagnostics && (textLower.includes('transmitter') || textLower.includes('reading'))) {
        knowledge += `\n[Transmitter diagnostics] ${extractSummary(troubleData.transmitter_diagnostics, 4, 500)}`;
      }
      // Control valve issues
      if (troubleData.control_valve_issues && (textLower.includes('valve') || textLower.includes('stiction') || textLower.includes('positioner'))) {
        knowledge += `\n[Valve troubleshooting] ${extractSummary(troubleData.control_valve_issues, 4, 500)}`;
      }
      // Temperature issues
      if (troubleData.temperature_measurement_troubleshooting && (textLower.includes('temperature') || textLower.includes('thermocouple') || textLower.includes('rtd'))) {
        knowledge += `\n[Temperature troubleshooting] ${extractSummary(troubleData.temperature_measurement_troubleshooting, 4, 400)}`;
      }
      // Level issues
      if (troubleData.level_measurement_troubleshooting && (textLower.includes('level') || textLower.includes('radar'))) {
        knowledge += `\n[Level troubleshooting] ${extractSummary(troubleData.level_measurement_troubleshooting, 4, 400)}`;
      }
      // Flow issues
      if (troubleData.flow_measurement_troubleshooting && (textLower.includes('flow') || textLower.includes('orifice') || textLower.includes('meter'))) {
        knowledge += `\n[Flow troubleshooting] ${extractSummary(troubleData.flow_measurement_troubleshooting, 4, 400)}`;
      }
      // Wiring issues
      if (troubleData.wiring_issues && (textLower.includes('wire') || textLower.includes('ground') || textLower.includes('shield') || textLower.includes('noise'))) {
        knowledge += `\n[Wiring troubleshooting] ${extractSummary(troubleData.wiring_issues, 4, 400)}`;
      }
      // DCS/PLC side
      if (troubleData.dcs_plc_side_troubleshooting && (textLower.includes('dcs') || textLower.includes('plc') || textLower.includes('scaling') || textLower.includes('channel'))) {
        knowledge += `\n[DCS/PLC troubleshooting] ${extractSummary(troubleData.dcs_plc_side_troubleshooting, 4, 400)}`;
      }
      // Analyzer problems
      if (troubleData.analyzer_problems && (textLower.includes('analyzer') || textLower.includes('sample') || textLower.includes('probe'))) {
        knowledge += `\n[Analyzer troubleshooting] ${extractSummary(troubleData.analyzer_problems, 4, 400)}`;
      }

      // Generic pass (task #45): non-instrumentation troubleshooting files
      // (electrical VFD_fault_codes/breaker_troubleshooting, millwright
      // pump/gearbox diagnostics, erection fit-up issues) by relevance.
      if (knowledge.length === troubleLenBefore && knowledge.length < MAX_KNOWLEDGE_CHARS) {
        for (const sec of findRelevantSections(troubleData, textLower, activeKeywordTokens, 2)) {
          if (knowledge.length >= MAX_KNOWLEDGE_CHARS) break;
          knowledge += `\n[Troubleshooting — ${sec.key.replace(/_/g, ' ')}] ${extractSummary(sec.data, 4, 450)}`;
        }
      }
    }
  }

  // Also check procedures-level troubleshooting (existing pattern)
  if (procData?.troubleshooting && !troubleData) {
    const ts = procData.troubleshooting;
    if (ts.signal_noise && (textLower.includes('noise') || textLower.includes('ground') || textLower.includes('emi'))) {
      knowledge += `\n[Signal noise] ${extractSummary(ts.signal_noise, 3, 300)}`;
    }
    if (ts.impulse_line_problems && (textLower.includes('impulse') || textLower.includes('plugg') || textLower.includes('frozen') || textLower.includes('stuck'))) {
      knowledge += `\n[Impulse line problems] ${extractSummary(ts.impulse_line_problems, 3, 400)}`;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 6. SPECIALTY INSTRUMENTS — analyzers, flow/level/temp types
  //    Source: {trade}_specialty.json (NEW)
  // ═══════════════════════════════════════════════════════════
  const specialtyData = readJsonSafe(path.join(KNOWLEDGE_DIR, `${trade}_specialty.json`));
  if (specialtyData) {
    // Analyzers
    if (specialtyData.analyzers && (textLower.includes('analyzer') || textLower.includes('ph') || textLower.includes('conductivity') || textLower.includes('chromatograph') || textLower.includes('o2') || textLower.includes('oxygen'))) {
      const az = specialtyData.analyzers;
      if (textLower.includes('ph') && az.pH) knowledge += `\n[pH analyzer] ${extractSummary(az.pH, 4, 500)}`;
      if ((textLower.includes('o2') || textLower.includes('oxygen')) && az.O2) knowledge += `\n[O2 analyzer] ${extractSummary(az.O2, 4, 500)}`;
      if (textLower.includes('conductivity') && az.conductivity) knowledge += `\n[Conductivity] ${extractSummary(az.conductivity, 4, 400)}`;
      if (textLower.includes('chromatograph') && az.gas_chromatograph) knowledge += `\n[Gas chromatograph] ${extractSummary(az.gas_chromatograph, 4, 500)}`;
      if (az.general_rules) knowledge += `\nAnalyzer rules: ${extractSummary(az.general_rules, 3, 200)}`;
    }

    // Flow meters
    if (specialtyData.flow_meters && (textLower.includes('flow') || textLower.includes('meter') || textLower.includes('coriolis') || textLower.includes('magnetic') || textLower.includes('vortex') || textLower.includes('ultrasonic'))) {
      const fm = specialtyData.flow_meters;
      if ((textLower.includes('mag') || textLower.includes('magnetic')) && fm.magnetic) knowledge += `\n[Mag meter] ${extractSummary(fm.magnetic, 4, 500)}`;
      if (textLower.includes('coriolis') && fm.coriolis) knowledge += `\n[Coriolis] ${extractSummary(fm.coriolis, 4, 500)}`;
      if (textLower.includes('ultrasonic') && fm.ultrasonic) knowledge += `\n[Ultrasonic flow] ${extractSummary(fm.ultrasonic, 4, 500)}`;
      if (textLower.includes('vortex') && fm.vortex) knowledge += `\n[Vortex] ${extractSummary(fm.vortex, 4, 400)}`;
      if (textLower.includes('turbine') && fm.turbine) knowledge += `\n[Turbine meter] ${extractSummary(fm.turbine, 4, 400)}`;
    }

    // Level instruments
    if (specialtyData.level_instruments && (textLower.includes('level') || textLower.includes('radar') || textLower.includes('guided wave') || textLower.includes('displacer') || textLower.includes('nuclear'))) {
      const li = specialtyData.level_instruments;
      if (textLower.includes('radar') && !textLower.includes('guided') && li.through_air_radar) knowledge += `\n[Radar level] ${extractSummary(li.through_air_radar, 4, 500)}`;
      if (textLower.includes('guided wave') && li.guided_wave_radar) knowledge += `\n[GWR] ${extractSummary(li.guided_wave_radar, 4, 500)}`;
      if ((textLower.includes('dp level') || textLower.includes('differential') && textLower.includes('level')) && li.dp_level) knowledge += `\n[DP level] ${extractSummary(li.dp_level, 4, 500)}`;
      if (textLower.includes('displacer') && li.displacer) knowledge += `\n[Displacer] ${extractSummary(li.displacer, 4, 400)}`;
      if (textLower.includes('nuclear') && li.nuclear) knowledge += `\n[Nuclear level] ${extractSummary(li.nuclear, 4, 400)}`;
    }

    // Safety instrumented systems
    if (specialtyData.safety_instrumented_systems && (textLower.includes('sis') || textLower.includes('sil') || textLower.includes('safety instrumented') || textLower.includes('proof test'))) {
      knowledge += `\n[Safety Instrumented Systems] ${extractSummary(specialtyData.safety_instrumented_systems, 5, 600)}`;
    }

    // Wireless
    if (specialtyData.wireless_instrumentation && (textLower.includes('wireless') || textLower.includes('wirelesshart') || textLower.includes('battery') || textLower.includes('mesh'))) {
      knowledge += `\n[Wireless instrumentation] ${extractSummary(specialtyData.wireless_instrumentation, 4, 500)}`;
    }

    // Pressure instruments
    if (specialtyData.pressure_instruments && (textLower.includes('pressure') || textLower.includes('diaphragm seal') || textLower.includes('remote seal') || textLower.includes('capillary'))) {
      if (textLower.includes('seal') || textLower.includes('capillary')) {
        if (specialtyData.pressure_instruments.diaphragm_seals) knowledge += `\n[Diaphragm seals] ${extractSummary(specialtyData.pressure_instruments.diaphragm_seals, 4, 400)}`;
      }
    }

    // Temperature — thermocouple/RTD deep knowledge
    if (specialtyData.temperature_instruments && (textLower.includes('thermocouple') || textLower.includes('rtd') || textLower.includes('thermowell') || textLower.includes('type k') || textLower.includes('type j'))) {
      const ti = specialtyData.temperature_instruments;
      if (ti.thermowell) knowledge += `\n[Thermowell] ${extractSummary(ti.thermowell, 4, 400)}`;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 7. CODES & STANDARDS
  //    Source: {trade}_codes_standards.json (NEW) + pipefitting
  // ═══════════════════════════════════════════════════════════
  // Task #45: this section was dead for ALL trades — the loader checked
  // lowercase keys (codesData.isa_5_1) against TitleCase JSON keys
  // (ISA_5_1_P_and_ID_symbols), and electrical's file is named
  // electrical_codes.json, not electrical_codes_standards.json. ~85KB of
  // codes knowledge never reached a single worker. Fixed with a filename
  // fallback + normalized-prefix lookup + a generic relevance pass.
  const codesData =
    readJsonSafe(path.join(KNOWLEDGE_DIR, `${trade}_codes_standards.json`)) ||
    readJsonSafe(path.join(KNOWLEDGE_DIR, `${trade}_codes.json`));
  if (codesData) {
    const codesLenBefore = knowledge.length;
    const usedCodeKeys = new Set();
    // Normalized-prefix lookup: 'isa51' resolves ISA_5_1_P_and_ID_symbols,
    // 'nec500' resolves NEC_500_506_hazardous_area_classification, etc.
    const codeByPrefix = (prefix) => {
      for (const k of Object.keys(codesData)) {
        if (META_KEYS.has(k) || usedCodeKeys.has(k)) continue;
        if (normKeyChars(k).startsWith(prefix)) {
          usedCodeKeys.add(k);
          return codesData[k];
        }
      }
      return null;
    };
    // ISA standards
    if (textLower.includes('isa') || textLower.includes('tag') || textLower.includes('p&id') || textLower.includes('pid')) {
      const v = codeByPrefix('isa51');
      if (v) knowledge += `\n[ISA 5.1 — P&ID symbols] ${extractSummary(v, 4, 500)}`;
    }
    if (textLower.includes('sil') || textLower.includes('sis') || textLower.includes('isa 84') || textLower.includes('iec 61511')) {
      const v = codeByPrefix('isa84');
      if (v) knowledge += `\n[ISA 84 / IEC 61511 — SIS] ${extractSummary(v, 5, 600)}`;
    }
    if (textLower.includes('control valve') || textLower.includes('cv') || textLower.includes('sizing')) {
      const v = codeByPrefix('isa75');
      if (v) knowledge += `\n[ISA 75 — valve sizing] ${extractSummary(v, 4, 400)}`;
    }
    // NEC hazardous areas
    if (textLower.includes('nec') || textLower.includes('classified') || textLower.includes('division') || textLower.includes('zone') || textLower.includes('hazardous') || textLower.includes('explosion')) {
      const v = codeByPrefix('nec500');
      if (v) knowledge += `\n[NEC 500-506 — Hazardous areas] ${extractSummary(v, 5, 600)}`;
    }
    // API standards
    if (textLower.includes('api') || textLower.includes('analyzer') || textLower.includes('sample system')) {
      if (textLower.includes('analyzer')) {
        const v = codeByPrefix('api555');
        if (v) knowledge += `\n[API 555 — Analyzers] ${extractSummary(v, 4, 400)}`;
      }
      const v551 = codeByPrefix('api551');
      if (v551) knowledge += `\n[API 551 — Measurement] ${extractSummary(v551, 3, 300)}`;
    }
    // Grounding/shielding standard
    if (textLower.includes('ground') || textLower.includes('shield') || textLower.includes('emi')) {
      const v = codeByPrefix('api554');
      if (v) knowledge += `\n[API 554 — Grounding/Shielding] ${extractSummary(v, 3, 300)}`;
    }
    // Generic pass: everything the named lookups don't know — ASME B31.3 /
    // Section IX (pipefitting), AISC / RCSC / Subpart R (erection), API 610/
    // 686 / alignment_tolerances (millwright), NEC ampacity / conduit-fill /
    // working-clearance tables (electrical). Gated on codes-ish words OR a
    // direct section-name hit in the transcript.
    if (knowledge.length < MAX_KNOWLEDGE_CHARS) {
      const codesWords = ['code', 'standard', 'spec', 'asme', 'b31', 'aws ', 'aisc', 'rcsc', 'osha', 'nec', 'api ', 'ampacity', 'derating', 'fill', 'clearance', 'torque', 'tolerance', 'qualification', 'wps', 'pqr'];
      const codesContext = codesWords.some((kw) => textLower.includes(kw));
      for (const sec of findRelevantSections(codesData, textLower, codesContext ? activeKeywordTokens : [], 2)) {
        if (usedCodeKeys.has(sec.key)) continue;
        if (!codesContext && sec.score < 2) continue; // need a real name hit without codes context
        if (knowledge.length >= MAX_KNOWLEDGE_CHARS) break;
        usedCodeKeys.add(sec.key);
        knowledge += `\n[Codes & standards — ${sec.key.replace(/_/g, ' ')}] ${extractSummary(sec.data, 4, 450)}`;
      }
    }
    if (knowledge.length === codesLenBefore && trade === 'pipefitting' && ['asme', 'b31', 'code', 'wps', 'pqr', 'section ix', 'aws'].some((kw) => textLower.includes(kw))) {
      // Last-resort named anchors for the most-asked piping codes.
      const b31 = codeByPrefix('asmeb313');
      if (b31) knowledge += `\n[ASME B31.3 — process piping] ${extractSummary(b31, 4, 450)}`;
      const ix = codeByPrefix('asmesectionix');
      if (ix) knowledge += `\n[ASME Section IX — welding quals] ${extractSummary(ix, 4, 450)}`;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 8. COMMISSIONING — startup procedures
  //    Source: commissioning.json (general) + procedures pre_commissioning
  // ═══════════════════════════════════════════════════════════
  if (['energize', 'startup', 'commission', 'pre-energization', 'bump test', 'checkout', 'pre-comm', 'itcc', 'turnover', 'mechanical completion'].some(kw => textLower.includes(kw))) {
    const commData = readJsonSafe(path.join(KNOWLEDGE_DIR, 'commissioning.json'));
    if (commData) {
      if (commData.instrument_commissioning_sequence) knowledge += `\n[Commissioning sequence] ${extractSummary(commData.instrument_commissioning_sequence, 5, 500)}`;
      if (commData.common_commissioning_mistakes) knowledge += `\nCommissioning mistakes to avoid: ${commData.common_commissioning_mistakes.slice(0, 4).join('; ')}`;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 9. LESSONS LEARNED
  // ═══════════════════════════════════════════════════════════
  if (['rework', 'mistake', 'problem', 'wrong', 'issue', 'deficiency', 'quality'].some(kw => textLower.includes(kw))) {
    const lessonsData = readJsonSafe(path.join(KNOWLEDGE_DIR, 'lessons_learned.json'));
    if (lessonsData) {
      // Task #45: every trade tries ITS OWN rework bucket first (so the
      // knowledge self-audit loop can grow per-trade lessons), falling back
      // to electrical only when the trade has none yet.
      const reworkData = lessonsData[`top_rework_causes_${trade}`] || lessonsData.top_rework_causes_electrical;
      if (reworkData) knowledge += `\nTop rework causes: ${reworkData.slice(0, 3).map(r => typeof r === 'string' ? r : r.cause).join('; ')}`;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 10. CREW / PRODUCTIVITY
  // ═══════════════════════════════════════════════════════════
  if (['crew', 'manpower', 'how many', 'how long', 'productivity', 'schedule', 'coordinate'].some(kw => textLower.includes(kw))) {
    const crewData = readJsonSafe(path.join(KNOWLEDGE_DIR, 'crew_productivity.json'));
    if (crewData?.crew_sizes) knowledge += `\nCrew size reference available for task planning`;
  }

  // ═══════════════════════════════════════════════════════════
  // 11. WEATHER / ENVIRONMENTAL
  // ═══════════════════════════════════════════════════════════
  if (['weather', 'cold', 'heat', 'rain', 'wind', 'humidity', 'freeze', 'hot'].some(kw => textLower.includes(kw))) {
    if (textLower.includes('cold') || textLower.includes('freeze')) knowledge += `\nCold weather: Instrument tubing can freeze — verify heat trace energized. Cable pulling min temp: PVC 14°F, XLPE -40°F.`;
    if (textLower.includes('heat') || textLower.includes('hot')) knowledge += `\nHeat stress: Water every 30 min above 80°F WBGT. 15 min rest/hr above 85°F. Transmitter electronics max ambient typically 185°F.`;
  }

  // ═══════════════════════════════════════════════════════════
  // 12. PIPE FITTING MATERIALS (pipefitting/erection trades)
  // ═══════════════════════════════════════════════════════════
  // Task #45: stub lines ("knowledge available…") replaced with real content
  // — stubs told the model knowledge existed with no way to fetch it, which
  // invites confident bluffing in a safety domain. Erection borrows the
  // pipefitting materials file here; pipefitting itself already got these
  // sections in the generic materials pass above.
  const pipeMatKeywords = ['pipe', 'flange', 'gasket', 'bolt', 'stud', 'elbow', 'tee', 'reducer', 'spool', 'carbon steel', 'chrome', 'alloy', 'weld neck', 'slip-on', 'torque'];
  if (trade === 'erection' && knowledge.length < MAX_KNOWLEDGE_CHARS && pipeMatKeywords.some(kw => textLower.includes(kw))) {
    const pipeMatData = readJsonSafe(path.join(KNOWLEDGE_DIR, 'pipefitting_materials.json'));
    if (pipeMatData) {
      for (const sec of findRelevantSections(pipeMatData, textLower, [], 2)) {
        if (knowledge.length >= MAX_KNOWLEDGE_CHARS) break;
        knowledge += `\n[Pipe materials — ${sec.key.replace(/_/g, ' ')}] ${extractSummary(sec.data, 4, 400)}`;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 13. RIGGING / CRANE (erection trade)
  // ═══════════════════════════════════════════════════════════
  // Codex MAJOR-2 fix: word-boundary regex, not substring — the old 'rig'
  // keyword matched "RIGID conduit" and would have pushed crane/rigging
  // content into ordinary electrical turns. 'steel'/'column'/'vessel' alone
  // are also too generic to mean a lift is happening; the gate now needs an
  // actual rigging/lifting word.
  const RIGGING_GATE = /\b(rig|rigs|rigged|rigging|rigger|riggers|crane|cranes|lift|lifts|lifting|sling|slings|shackle|shackles|spreader|tailing|ironworker|iron worker)\b/;
  if (trade !== 'millwright' && (trade === 'erection' || RIGGING_GATE.test(textLower)) && knowledge.length < MAX_KNOWLEDGE_CHARS) {
    const riggingData = readJsonSafe(path.join(KNOWLEDGE_DIR, 'rigging_crane_operations.json'));
    if (riggingData) {
      const sections = findRelevantSections(riggingData, textLower, ['sling', 'crane', 'rigging', 'lift'], 2);
      for (const sec of sections) {
        if (knowledge.length >= MAX_KNOWLEDGE_CHARS) break;
        knowledge += `\n[Rigging — ${sec.key.replace(/_/g, ' ')}] ${extractSummary(sec.data, 4, 450)}`;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 14. SAFETY DEPARTMENT (safety trade)
  // ═══════════════════════════════════════════════════════════
  if (trade === 'safety') {
    const safetyDeptData = readJsonSafe(path.join(KNOWLEDGE_DIR, 'safety_department.json'));
    if (safetyDeptData) {
      if (safetyDeptData.voice_assistant_quick_reference) {
        const qr = safetyDeptData.voice_assistant_quick_reference;
        const refs = Object.entries(qr).slice(0, 10).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join('; ');
        knowledge += `\nSafety quick reference: ${refs}`;
      }
      // Task #45: the nine deep sections (section_01_osha_regulations …
      // section_08_site_safety_programs) are now served by SECTION 1's
      // safety_department.json fallback (task-matched, summarized content) —
      // the old stub lines here are gone, and re-injecting the sections here
      // would duplicate them. Only the quick reference remains this section's
      // job.
    }
  }


  // ═══════════════════════════════════════════════════════════
  // 15. BOILERMAKER SPECIALTY (pipefitting trade, boilermaker role)
  // ═══════════════════════════════════════════════════════════
  const boilerKeywords = ['boiler', 'tube', 'drum', 'steam drum', 'mud drum', 'waterwall', 'economizer', 'superheater', 'reheater', 'refractory', 'castable', 'firebrick', 'tube sheet', 'tube bundle', 'tube rolling', 'tube plug', 'vessel', 'pressure vessel', 'manway', 'ASME Section I', 'ASME Section VIII', 'NBIC', 'R stamp'];
  if (trade === 'pipefitting' && knowledge.length < MAX_KNOWLEDGE_CHARS && boilerKeywords.some(kw => textLower.includes(kw))) {
    const boilerData = readJsonSafe(path.join(KNOWLEDGE_DIR, 'pipefitting_boilermaker.json'));
    if (boilerData) {
      // Task #45: stubs → real content by relevance (tube rolling, refractory,
      // drums, bundle pulling, NBIC repairs).
      for (const sec of findRelevantSections(boilerData, textLower, ['tube', 'refractory', 'vessel', 'drum', 'bundle', 'nbic'], 2)) {
        if (knowledge.length >= MAX_KNOWLEDGE_CHARS) break;
        knowledge += `\n[Boilermaker — ${sec.key.replace(/_/g, ' ')}] ${extractSummary(sec.data, 4, 450)}`;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 16. MILLWRIGHT — RIGGING AND EQUIPMENT SETTING
  // ═══════════════════════════════════════════════════════════
  if (trade === 'millwright' && knowledge.length < MAX_KNOWLEDGE_CHARS && (/\b(rig|rigs|rigged|rigging|rigger|crane|cranes|lift|lifts|lifting|sling|slings|setting|set)\b/.test(textLower) || textLower.includes('exchanger') || textLower.includes('vessel'))) {
    const riggingData = readJsonSafe(path.join(KNOWLEDGE_DIR, 'rigging_crane_operations.json'));
    if (riggingData) {
      for (const sec of findRelevantSections(riggingData, textLower, ['sling', 'crane', 'rigging', 'lift', 'setting'], 2)) {
        if (knowledge.length >= MAX_KNOWLEDGE_CHARS) break;
        knowledge += `\n[Rigging — ${sec.key.replace(/_/g, ' ')}] ${extractSummary(sec.data, 4, 400)}`;
      }
    }
  }

  return knowledge;
}

module.exports = { TASK_KEYWORDS, loadRefineKnowledge };
