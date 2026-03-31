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
  const safetyData = readJsonSafe(path.join(KNOWLEDGE_DIR, `${trade}_safety.json`));
  if (safetyData) {
    const taskMatches = [];
    for (const [task, keywords] of Object.entries(taskKeywords)) {
      if (keywords.some(kw => textLower.includes(kw)) && safetyData.tasks && safetyData.tasks[task]) {
        const td = safetyData.tasks[task];
        const summary = [];
        if (td.ppe) summary.push(`PPE: ${td.ppe.join(', ')}`);
        if (td.jsa_items) summary.push(`JSA items: ${td.jsa_items.slice(0, 4).join('; ')}`);
        if (td.permits) summary.push(`Permits needed: ${td.permits.join(', ')}`);
        if (td.hazards) summary.push(`Key hazards: ${td.hazards.slice(0, 3).join('; ')}`);
        if (td.safety) summary.push(`Safety: ${td.safety.slice(0, 4).join('; ')}`);
        if (td.requirements) summary.push(`Requirements: ${(Array.isArray(td.requirements) ? td.requirements : []).slice(0, 3).join('; ')}`);
        taskMatches.push(`[${task.replace(/_/g, ' ')}] ${summary.join('. ')}`);
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

    // Match specific procedure sections based on keywords
    for (const [task, keywords] of Object.entries(taskKeywords)) {
      if (!keywords.some(kw => textLower.includes(kw))) continue;

      // Look for matching section in procedures (e.g., "calibration" → calibration_procedure or calibration)
      const possibleKeys = [task, task.replace(/_/g, ''), `${task}_procedure`];
      for (const key of possibleKeys) {
        if (procData[key]) {
          const section = procData[key];
          if (section.steps) {
            knowledge += `\n[${task.replace(/_/g, ' ')} procedure] Steps: ${section.steps.slice(0, 5).join('; ')}`;
          }
          if (section.common_mistakes) {
            knowledge += `\nCommon mistakes: ${(Array.isArray(section.common_mistakes) ? section.common_mistakes : Object.values(section.common_mistakes)).slice(0, 3).join('; ')}`;
          }
          if (section.common_errors) {
            knowledge += `\nCommon errors: ${section.common_errors.slice(0, 3).join('; ')}`;
          }
          break;
        }
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
  }

  // Fallback: generic materials_specs.json (for electrical/general)
  if (!tradeMatData) {
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
  }

  // ═══════════════════════════════════════════════════════════
  // 5. TROUBLESHOOTING — diagnostic knowledge
  //    Source: {trade}_troubleshooting.json (NEW)
  // ═══════════════════════════════════════════════════════════
  const troubleData = readJsonSafe(path.join(KNOWLEDGE_DIR, `${trade}_troubleshooting.json`));
  if (troubleData) {
    const troubleKeywords = ['problem', 'issue', 'trouble', 'fault', 'fail', 'not working', 'erratic', 'stuck', 'wrong', 'noise', 'drift', 'error', 'diagnos'];
    const isTroubleshooting = troubleKeywords.some(kw => textLower.includes(kw));

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
  const codesData = readJsonSafe(path.join(KNOWLEDGE_DIR, `${trade}_codes_standards.json`));
  if (codesData) {
    // ISA standards
    if (textLower.includes('isa') || textLower.includes('tag') || textLower.includes('p&id') || textLower.includes('pid')) {
      if (codesData.isa_5_1) knowledge += `\n[ISA 5.1 — P&ID symbols] ${extractSummary(codesData.isa_5_1, 4, 500)}`;
    }
    if (textLower.includes('sil') || textLower.includes('sis') || textLower.includes('isa 84') || textLower.includes('iec 61511')) {
      if (codesData.isa_84_iec_61511) knowledge += `\n[ISA 84 / IEC 61511 — SIS] ${extractSummary(codesData.isa_84_iec_61511, 5, 600)}`;
    }
    if (textLower.includes('control valve') || textLower.includes('cv') || textLower.includes('sizing')) {
      if (codesData.isa_75) knowledge += `\n[ISA 75 — valve sizing] ${extractSummary(codesData.isa_75, 4, 400)}`;
    }
    // NEC hazardous areas
    if (textLower.includes('nec') || textLower.includes('classified') || textLower.includes('division') || textLower.includes('zone') || textLower.includes('hazardous') || textLower.includes('explosion')) {
      if (codesData.nec_500_506) knowledge += `\n[NEC 500-506 — Hazardous areas] ${extractSummary(codesData.nec_500_506, 5, 600)}`;
    }
    // API standards
    if (textLower.includes('api') || textLower.includes('analyzer') || textLower.includes('sample system')) {
      if (codesData.api_555 && textLower.includes('analyzer')) knowledge += `\n[API 555 — Analyzers] ${extractSummary(codesData.api_555, 4, 400)}`;
      if (codesData.api_551) knowledge += `\n[API 551 — Measurement] ${extractSummary(codesData.api_551, 3, 300)}`;
    }
    // Grounding/shielding standard
    if (textLower.includes('ground') || textLower.includes('shield') || textLower.includes('emi')) {
      if (codesData.api_554) knowledge += `\n[API 554 — Grounding/Shielding] ${extractSummary(codesData.api_554, 3, 300)}`;
    }
  }

  // Fallback: piping codes for pipefitting trade
  if (!codesData && ['asme', 'b31', 'code', 'wps', 'pqr', 'welder qualification', 'section ix', 'aws'].some(kw => textLower.includes(kw))) {
    if (readJsonSafe(path.join(KNOWLEDGE_DIR, 'pipefitting_codes_standards.json'))) {
      knowledge += `\nPiping codes and standards knowledge available — ASME B31.3, B31.1, Section IX, welding qualifications.`;
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
      const reworkKey = `top_rework_causes_${trade === 'pipefitting' ? 'pipefitting' : trade === 'erection' ? 'erection' : trade === 'instrumentation' ? 'instrumentation' : 'electrical'}`;
      if (lessonsData[reworkKey]) knowledge += `\nTop rework causes: ${lessonsData[reworkKey].slice(0, 3).map(r => typeof r === 'string' ? r : r.cause).join('; ')}`;
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
  const pipeMatKeywords = ['pipe', 'flange', 'gasket', 'bolt', 'stud', 'elbow', 'tee', 'reducer', 'spool', 'carbon steel', 'chrome', 'alloy', 'weld neck', 'slip-on'];
  if ((trade === 'pipefitting' || trade === 'erection') && pipeMatKeywords.some(kw => textLower.includes(kw))) {
    const pipeMatData = readJsonSafe(path.join(KNOWLEDGE_DIR, 'pipefitting_materials.json'));
    if (pipeMatData) {
      if (textLower.includes('flange') || textLower.includes('gasket') || textLower.includes('bolt')) knowledge += `\nPipe fitting material knowledge available for flanges, gaskets, and bolt specifications.`;
      if (textLower.includes('torque')) knowledge += `\nBolt torque knowledge available — ask about specific flange size and class.`;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 13. RIGGING / CRANE (erection trade)
  // ═══════════════════════════════════════════════════════════
  const riggingKeywords = ['rig', 'rigging', 'crane', 'lift', 'sling', 'shackle', 'spreader', 'vessel', 'column', 'exchanger', 'module', 'steel', 'erection', 'iron'];
  if (trade === 'erection' || riggingKeywords.some(kw => textLower.includes(kw))) {
    const riggingData = readJsonSafe(path.join(KNOWLEDGE_DIR, 'rigging_crane_operations.json'));
    if (riggingData?.sling_capacities || riggingData?.crane_signals) knowledge += `\nRigging and crane operations knowledge available — sling capacities, crane signals, lift planning.`;
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
      if (textLower.includes('permit')) knowledge += `\nPermit system knowledge available — hot work, confined space, excavation, line break, LOTO.`;
      if (textLower.includes('incident') || textLower.includes('investigation')) knowledge += `\nIncident investigation knowledge: 5 Whys, fishbone, OSHA recordability criteria, reporting deadlines.`;
      if (textLower.includes('trir') || textLower.includes('metric') || textLower.includes('rate')) knowledge += `\nSafety metrics: TRIR formula (recordables x 200,000 / hours worked). Excellent <0.5, world class <0.3.`;
      if (textLower.includes('training') || textLower.includes('osha')) knowledge += `\nTraining requirements knowledge available — OSHA 10/30, fall protection, confined space, crane, forklift, first aid.`;
      if (textLower.includes('jsa') || textLower.includes('jha') || textLower.includes('hazard')) knowledge += `\nJSA/JHA creation knowledge: hazard categories, risk matrix, hierarchy of controls, task-specific templates.`;
    }
  }

  return knowledge;
}

module.exports = { TASK_KEYWORDS, loadRefineKnowledge };
