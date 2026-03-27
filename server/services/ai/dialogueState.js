/**
 * Dialogue State Manager
 * Defines the structured output contract for /refine dialogue phase.
 * Makes AI reasoning explicit and controllable.
 *
 * The AI returns structured JSON with:
 * - known_fields: what it believes it already understands
 * - missing_fields: what still matters
 * - confidence_by_field: 0.0-1.0 per field
 * - spoken_response: warm, brief, coworker-like response
 * - ready_to_finalize: boolean
 * - next_question_reason: internal explanation
 * - key_points: summary bullets
 */

/**
 * Field definitions by context type — what a complete record looks like
 */
const FIELD_SCHEMAS = {
  daily_task: {
    required: ['task_goal', 'assigned_to', 'location'],
    important: ['safety_jsa_permits', 'materials_constraints', 'priority'],
    optional: ['coordination', 'deadline'],
    labels: {
      task_goal: 'Task goal / main work',
      assigned_to: 'Who is assigned',
      location: 'Exact location',
      safety_jsa_permits: 'Safety / JSA / permits needed',
      materials_constraints: 'Materials / constraints / coordination',
      priority: 'Priority level',
      coordination: 'Other trade coordination',
      deadline: 'Deadline or urgency',
    },
  },
  shift_update: {
    required: ['work_completed', 'issues_delays'],
    important: ['quantity_progress', 'safety_observations', 'tomorrow_plan'],
    optional: ['hours_worked', 'crew_size', 'materials_used'],
    labels: {
      work_completed: 'Work completed today',
      issues_delays: 'Issues / blockers / delays',
      quantity_progress: 'Measurable progress (footage, units, etc.)',
      safety_observations: 'Safety observations or near-misses',
      tomorrow_plan: 'Plan for tomorrow',
      hours_worked: 'Hours worked',
      crew_size: 'Crew size',
      materials_used: 'Materials used',
    },
  },
  punch_list: {
    required: ['issue_description', 'location'],
    important: ['severity_urgency', 'responsible_trade'],
    optional: ['safety_implication', 'code_violation'],
    labels: {
      issue_description: 'Issue / deficiency description',
      location: 'Exact location',
      severity_urgency: 'Severity / urgency',
      responsible_trade: 'Responsible trade',
      safety_implication: 'Safety implication',
      code_violation: 'Code or spec violation',
    },
  },
};

/**
 * Build the structured dialogue output instruction for prompts
 */
function getDialogueOutputInstruction(contextType) {
  const schema = FIELD_SCHEMAS[contextType] || FIELD_SCHEMAS.daily_task;
  const allFields = [...schema.required, ...schema.important, ...schema.optional];
  const fieldList = allFields.map(f => `"${f}": "${schema.labels[f]}"`).join(', ');

  return `Return a JSON object with EXACTLY these keys:

- "known_fields": object — what you believe you already know from the conversation. Keys are field names, values are your best understanding. Use these field names: ${fieldList}. Only include fields where the worker actually provided information.

- "missing_fields": array of strings — field names that are still missing and would improve the report. Order by importance: ${schema.required.map(f => `"${f}"`).join(', ')} are most important, then ${schema.important.map(f => `"${f}"`).join(', ')}, then ${schema.optional.map(f => `"${f}"`).join(', ')}.

- "confidence_by_field": object — confidence scores (0.0 to 1.0) for each known field. 1.0 = worker stated it clearly. 0.5 = you inferred it. 0.0 = unknown.

- "ready_to_finalize": boolean — true if all required fields (${schema.required.map(f => `"${f}"`).join(', ')}) are known with confidence >= 0.7. Don't drag the conversation out unnecessarily.

- "next_question_reason": string — brief internal reason why you're asking the next question (e.g., "Worker described conduit work but didn't mention which area or rack"). This is for debugging, not spoken aloud.

- "spoken_response": string — your actual reply to the worker. 2-4 sentences max. Start by reflecting something specific they said. Ask ONE targeted question about the most important missing field. Sound like a capable coworker, not a form. Same language the worker used.

- "key_points": array of strings — bullet-point summary of everything gathered so far.

- "safety_flag": boolean — true if the worker mentioned anything safety-related (PPE, hazards, incidents, near-misses, permits, LOTO, fall protection, etc.)

Return ONLY valid JSON.`;
}

/**
 * Check if a dialogue state is ready to finalize based on field completeness
 */
function shouldFinalize(dialogueResult, contextType) {
  const schema = FIELD_SCHEMAS[contextType] || FIELD_SCHEMAS.daily_task;
  if (!dialogueResult || !dialogueResult.known_fields) return false;

  // Check all required fields are known with sufficient confidence
  const confidence = dialogueResult.confidence_by_field || {};
  const known = dialogueResult.known_fields || {};

  for (const field of schema.required) {
    if (!known[field] || (confidence[field] || 0) < 0.5) return false;
  }

  return true;
}

/**
 * Get the next most important missing field to ask about
 */
function getNextPriorityField(dialogueResult, contextType) {
  const schema = FIELD_SCHEMAS[contextType] || FIELD_SCHEMAS.daily_task;
  const known = dialogueResult?.known_fields || {};
  const confidence = dialogueResult?.confidence_by_field || {};

  // Check required fields first, then important, then optional
  const priorityOrder = [...schema.required, ...schema.important, ...schema.optional];

  for (const field of priorityOrder) {
    if (!known[field] || (confidence[field] || 0) < 0.5) {
      return { field, label: schema.labels[field], priority: schema.required.includes(field) ? 'required' : schema.important.includes(field) ? 'important' : 'optional' };
    }
  }

  return null; // All fields are known
}

module.exports = {
  FIELD_SCHEMAS,
  getDialogueOutputInstruction,
  shouldFinalize,
  getNextPriorityField,
};
