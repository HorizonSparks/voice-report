/**
 * Safety Detector
 * Rule-based pre-Claude safety keyword scan.
 * Runs before the AI call to flag safety mentions so Claude
 * never accidentally ignores them.
 */

const SAFETY_TERMS = [
  // PPE
  'ppe', 'hard hat', 'helmet', 'safety glasses', 'goggles', 'gloves',
  'harness', 'lanyard', 'fall protection', 'hi-vis', 'high visibility',
  'ear plugs', 'ear protection', 'respirator', 'face shield', 'steel toe',
  // Hazards
  'fall', 'trip', 'slip', 'struck by', 'caught between', 'pinch point',
  'electrocution', 'shock', 'arc flash', 'energized', 'live wire',
  'burn', 'chemical', 'toxic', 'fumes', 'exposure', 'radiation',
  // Permits & procedures
  'permit', 'hot work', 'confined space', 'lockout', 'tagout', 'loto',
  'excavation', 'scaffold', 'elevated work', 'working at height',
  'fire watch', 'hole watch', 'barricade', 'caution tape',
  // Incidents
  'near miss', 'near-miss', 'incident', 'injury', 'accident',
  'unsafe', 'hazard', 'violation', 'stopped work', 'stop work',
  'first aid', 'medical', 'emergency',
  // Equipment safety
  'fire extinguisher', 'eyewash', 'safety shower', 'gas test',
  'gas monitor', 'oxygen', 'lel', 'h2s',
  // Rigging/crane
  'rigging', 'crane', 'lift plan', 'sling', 'shackle', 'load',
  'tag line', 'signal', 'swing radius',
  // Spanish equivalents
  'casco', 'arnés', 'guantes', 'lentes', 'gafas', 'protección',
  'caída', 'peligro', 'seguridad', 'permiso', 'bloqueo',
  'incidente', 'accidente', 'lesión', 'emergencia', 'extintor',
  'inseguro', 'riesgo', 'andamio', 'grúa', 'eslinga',
];

// Pre-compile lowercase terms for fast matching
const SAFETY_PATTERNS = SAFETY_TERMS.map(term => ({
  term,
  regex: new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
}));

/**
 * Scan text for safety-related mentions
 * @param {string} text - Transcript or conversation text to scan
 * @returns {{ detected: boolean, terms: string[], summary: string }}
 */
function detectSafety(text) {
  if (!text || typeof text !== 'string') {
    return { detected: false, terms: [], summary: '' };
  }

  const lower = text.toLowerCase();
  const matched = [];

  for (const { term, regex } of SAFETY_PATTERNS) {
    if (regex.test(lower)) {
      matched.push(term);
    }
  }

  if (matched.length === 0) {
    return { detected: false, terms: [], summary: '' };
  }

  return {
    detected: true,
    terms: matched,
    summary: `Safety keywords detected: ${matched.join(', ')}. Ensure these are addressed in the conversation and report.`,
  };
}

module.exports = { detectSafety, SAFETY_TERMS };
