/**
 * Knowledge Self-Audit Agent (knowledge.selfAudit.v1) — Move 2 of the self-improvement loop.
 *
 * Reads (1) the platform's CURRENT captured lessons and (2) a batch of recent
 * field reports, then finds RECURRING root causes of rework / delay / material
 * problems / quality+safety issues that are NOT already captured — and proposes
 * them as new prevention-oriented lessons for HUMAN review.
 *
 * This file is the agent DEFINITION only (pure, no I/O), mirroring jsaAnalyzer:
 *   - STATIC system prompt (role + output contract). Variable data (lessons +
 *     reports) is placed in the USER message by the caller, never in the system
 *     prompt — reduces prompt-injection risk.
 *   - buildUserContent() assembles that user message.
 * The orchestration (load reports, call runAgent, propose into the review queue)
 * lives in services/ai/knowledgeSelfAuditJob.js so this stays trivially testable.
 *
 * The agent NEVER writes knowledge directly — it only emits proposals. The only
 * module allowed to mutate the corpus is knowledgeWriter.js, and only after an
 * owner approves via the Sparks Agent.
 */

const { defineAgent } = require('../agentRuntime');

// The three array sections this audit is allowed to target. Each holds
// {cause, prevention} items. `pipefitting` may not exist yet — that is expected
// (200 pipe-fitting reports currently have zero captured lessons).
const ALLOWED_SECTIONS = Object.freeze([
  'top_rework_causes_electrical',
  'top_rework_causes_instrumentation',
  'top_rework_causes_pipefitting',
]);

const SYSTEM_PROMPT =
  'You are the Knowledge Self-Audit for Horizon Sparks, a voice-first field-reporting ' +
  'platform for industrial Electrical, Instrumentation, and Pipe Fitting trades.\n\n' +
  'The user message gives you (1) the platform\'s CURRENT captured lessons and (2) a ' +
  'batch of recent field reports (each prefixed with its report id in square brackets). ' +
  'Your job: find RECURRING root causes of rework, delay, material/equipment problems, ' +
  'and quality or safety issues that appear across MULTIPLE reports and are NOT already ' +
  'captured — then propose them as new prevention-oriented lessons for human review.\n\n' +
  'RULES:\n' +
  '- Propose a lesson ONLY if it is supported by at least 2 DISTINCT reports. One-off ' +
  'events are not lessons. Put the supporting report ids in "evidence".\n' +
  '- Do NOT duplicate or lightly reword a lesson that is already captured. If the current ' +
  'lessons already cover it, leave it out.\n' +
  '- Each lesson is { "cause": ..., "prevention": ... }. cause = the recurring failure seen ' +
  'in the field. prevention = a concrete, actionable practice a foreman or journeyman can ' +
  'apply to prevent it. Keep BOTH cause and prevention to ONE concise sentence each, matching ' +
  'the terse style of the existing captured lessons. Keep "rationale" to one short sentence.\n' +
  '- Lessons MUST be GENERAL. Never include worker names, company names, project names, or ' +
  'any other identifying detail — generalize the pattern.\n' +
  '- "section" MUST be exactly one of: "top_rework_causes_electrical", ' +
  '"top_rework_causes_instrumentation", "top_rework_causes_pipefitting". Pick by the trade ' +
  'of the supporting reports. The pipefitting section may be new — that is allowed.\n' +
  '- "evidence" MUST list the ids (exactly as shown in square brackets) of at least 2 distinct ' +
  'supporting reports.\n' +
  '- "confidence" is 0.0-1.0 reflecting how strongly the reports support the lesson.\n' +
  '- Return AT MOST 6 proposals, highest-signal first. If nothing meets the bar, return an ' +
  'empty "proposals" array — do NOT invent lessons.\n' +
  '- Also return "audit_notes": brief, advisory observations about any EXISTING lesson that ' +
  'recent field reality appears to contradict or make stale. These are notes only, not changes.\n\n' +
  'Return ONLY valid JSON (no markdown):\n' +
  '{ "proposals": [ { "section": "...", "cause": "...", "prevention": "...", ' +
  '"evidence": ["reportId"], "confidence": 0.0, "rationale": "why recurring and why not already covered" } ], ' +
  '"audit_notes": [ { "existing_section": "...", "observation": "...", "severity": "low" } ] }';

/**
 * Build the USER message from the variable inputs.
 * @param {object} args
 * @param {object} args.lessons  - current {section: items[]} captured lessons (the dedupe reference)
 * @param {Array}  args.reports  - [{ id, trade, date, text }]
 */
function buildUserContent({ lessons, reports } = {}) {
  if (!Array.isArray(reports) || reports.length === 0) {
    throw new Error('knowledgeSelfAudit.buildUserContent: non-empty reports array required');
  }
  const lessonsBlock = JSON.stringify(lessons || {}, null, 0);
  const reportsBlock = reports
    .map(r => `[${r.id}] (${r.trade || 'unknown'} | ${r.date || ''})\n${String(r.text || '').trim()}`)
    .join('\n\n');
  return (
    `CURRENT CAPTURED LESSONS (do NOT duplicate any of these):\n${lessonsBlock}\n\n` +
    `=== ${reports.length} RECENT FIELD REPORTS ===\n${reportsBlock}\n`
  );
}

const agent = defineAgent({
  name: 'knowledge.selfAudit.v1',
  model: 'claude-opus-4-7',
  systemPrompt: SYSTEM_PROMPT,
  tools: [],
  mcpServers: [],
  jsonMode: true,
  guardrails: {
    maxTokens: 4000,           // 6 terse proposals + audit_notes; 2500 truncated mid-JSON
    timeoutMs: 120000,
    costLimitPerCallCents: 60, // est ~17c (in ~7c + out 10c); 60c is generous headroom
    blockPII: false,           // reports are internal field data; output is generalized (no PII)
  },
});

module.exports = Object.freeze({
  ...agent,
  agent,
  buildUserContent,
  SYSTEM_PROMPT,
  ALLOWED_SECTIONS,
});
