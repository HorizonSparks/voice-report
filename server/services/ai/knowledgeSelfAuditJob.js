/**
 * Knowledge Self-Audit Job — the runnable orchestration for knowledge.selfAudit.v1.
 *
 * Pipeline (Move 2 of the self-improvement loop):
 *   recent field reports + current lessons  ->  runAgent(knowledge.selfAudit.v1)
 *   ->  validated {cause, prevention} proposals  ->  knowledgeWriter.propose()
 *   ->  human-review queue (knowledge/_pending.json).
 *
 * It NEVER writes canonical knowledge. Proposals sit in the queue until an owner
 * approves them via the Sparks Agent (approve_knowledge_proposal). Advisory
 * "audit_notes" about possibly-stale existing lessons are written to a read-only
 * sidecar (knowledge/_audit_notes.json, ignored by knowledgeCache) for review.
 *
 * Run manually:   node server/services/ai/knowledgeSelfAuditJob.js [--dry-run] [--limit=N]
 * Schedule:       require('./knowledgeSelfAuditJob').schedule()  (env-gated, see bottom)
 */

const fs = require('fs');
const path = require('path');
const { runAgent } = require('./agentRuntime');
const knowledgeWriter = require('./knowledgeWriter');
const selfAuditAgent = require('./agents/knowledgeSelfAudit');
const DB = require('../../../database/db');

const LESSONS_FILE = path.join(knowledgeWriter.KNOWLEDGE_DIR, 'lessons_learned.json');
const AUDIT_NOTES_FILE = path.join(knowledgeWriter.KNOWLEDGE_DIR, '_audit_notes.json');
const TARGET_FILE = 'lessons_learned.json';
const ALLOWED = new Set(selfAuditAgent.ALLOWED_SECTIONS);
const MAX_PROPOSALS = 6;
const DEFAULT_LIMIT = 300;
// Bound the worst-case INPUT so a future batch of large reports can't push the
// pre-call cost estimate over the agent's 60c guard (which would hard-block the
// run). Most field reports are <200 chars; 1000 keeps the issue context while
// capping 300 reports at ~50c estimated. This is a cost guard, not a data change.
const MAX_REPORT_CHARS = 1000;
// Pre-flight budget on the ASSEMBLED prompt. The agent's 60c cost guard would
// hard-fail a run late if a manual --limit batch ballooned the input; this trims
// the batch up front (newest kept) and logs what was dropped (no silent cap).
const MAX_TOTAL_INPUT_CHARS = 150000;
// audit_notes are MODEL output written to a disk sidecar — validate + size-cap so
// a malicious report body can't write arbitrary/unbounded text there.
const MAX_AUDIT_NOTES = 10;
const MAX_NOTE_CHARS = 500;
const VALID_SEVERITY = new Set(['low', 'medium', 'high']);

// Constant (no user input) keyword filter — focuses the scan on reports that
// actually describe a problem, which keeps signal high and token cost bounded.
const ISSUE_REGEX =
  '(ran out|short|shortage|missing|wrong|redo|rework|again|delay|wait|leak|fail|error|' +
  'defect|punch|incorrect|no material|out of|damage|backwards|reversed|not install|' +
  'undersize|exceed|hold|stuck|stop|rejected|nonconformance|ncr)';

// ---- helpers ------------------------------------------------------------

function loadCurrentLessons() {
  let obj;
  try {
    obj = JSON.parse(fs.readFileSync(LESSONS_FILE, 'utf8'));
  } catch {
    return {};
  }
  // Only hand the model the cause/prevention sections it can target — keeps the
  // prompt small and the dedupe reference focused.
  const out = {};
  for (const s of selfAuditAgent.ALLOWED_SECTIONS) {
    if (Array.isArray(obj[s])) out[s] = obj[s];
  }
  return out;
}

function normalizeCause(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Backstop dedupe: the writer also dedupes on APPLY, but skipping an exact
// re-propose here keeps the review queue clean across repeated runs.
function isDuplicateCause(lessons, section, cause) {
  const existing = Array.isArray(lessons[section]) ? lessons[section] : [];
  const target = normalizeCause(cause);
  return existing.some(item => normalizeCause(item && item.cause) === target);
}

// Queue hygiene: also skip causes ALREADY sitting in the pending review queue
// from a prior self-audit run, so repeated runs don't pile up the same lesson.
// Returns a Set of `${section}::${normalizedCause}` keys already pending.
function pendingCauseKeys() {
  const keys = new Set();
  let pending = [];
  try {
    pending = knowledgeWriter.listProposals({ status: 'pending', limit: 500 }) || [];
  } catch {
    return keys; // best-effort; canonical-lessons dedupe still applies
  }
  for (const entry of pending) {
    if (!entry || entry.source !== 'self_audit') continue;
    const cand = entry.candidate || {};
    const section = cand.section;
    const items = Array.isArray(cand.items) ? cand.items : [];
    for (const it of items) {
      if (it && it.cause) keys.add(`${section}::${normalizeCause(it.cause)}`);
    }
  }
  return keys;
}

function atomicWriteJson(fp, obj) {
  const tmp = `${fp}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, fp);
}

function writeAuditNotes(notes) {
  atomicWriteJson(AUDIT_NOTES_FILE, {
    generated_at: new Date().toISOString(),
    source: 'knowledge.selfAudit.v1',
    note: 'Advisory only. These are observations about possibly-stale lessons, NOT changes. Read-only.',
    notes,
  });
}

// audit_notes are raw MODEL output destined for a disk sidecar. Validate shape,
// cap count + per-note length, and constrain the fields so a manipulated report
// can't write arbitrary or unbounded content. Empty observations are dropped.
function sanitizeAuditNotes(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_AUDIT_NOTES).map(n => {
    const section = (n && typeof n.existing_section === 'string' && ALLOWED.has(n.existing_section))
      ? n.existing_section
      : 'unspecified';
    const observation = (n && typeof n.observation === 'string')
      ? n.observation.trim().slice(0, MAX_NOTE_CHARS)
      : '';
    const sev = n && typeof n.severity === 'string' ? n.severity.toLowerCase() : '';
    const severity = VALID_SEVERITY.has(sev) ? sev : 'low';
    return { existing_section: section, observation, severity };
  }).filter(n => n.observation);
}

async function loadReports(limit) {
  const { rows } = await DB.db.query(
    `SELECT id, trade, created_at, markdown_structured
       FROM voicereport.reports
      WHERE markdown_structured IS NOT NULL
        AND length(markdown_structured) > 40
        AND markdown_structured ~* $2
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit, ISSUE_REGEX]
  );
  return rows.map(r => ({
    id: r.id,
    trade: r.trade,
    date: r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : '',
    text: String(r.markdown_structured || '').slice(0, MAX_REPORT_CHARS),
  }));
}

// Trim the report batch so the assembled prompt stays under the char budget.
// Reports arrive newest-first; keep from the front until the budget is spent.
function capTotalInput(reports) {
  let total = 0, dropped = 0;
  const kept = [];
  for (const r of reports) {
    const len = String(r.text || '').length + 80; // text + per-report header overhead
    if (total + len > MAX_TOTAL_INPUT_CHARS) { dropped++; continue; }
    total += len;
    kept.push(r);
  }
  if (dropped > 0) {
    console.log(`[knowledge.selfAudit] input budget: kept ${kept.length}, dropped ${dropped} report(s) to stay under ${MAX_TOTAL_INPUT_CHARS} chars`);
  }
  return kept;
}

// ---- main ---------------------------------------------------------------

/**
 * @param {object} [opts]
 * @param {number} [opts.limit]   - max reports to scan (default 300, hard cap 1000)
 * @param {boolean}[opts.dryRun]  - if true, do NOT enqueue proposals; just report what it found
 * @returns {Promise<object>} summary
 */
async function run(opts = {}) {
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || DEFAULT_LIMIT, 1), 500);
  const dryRun = !!opts.dryRun;
  const startedAt = new Date().toISOString();

  let reports = await loadReports(limit);
  reports = capTotalInput(reports);
  if (reports.length === 0) {
    return { ok: true, dryRun, scanned: 0, proposed: 0, skipped: 0, errors: [], proposalIds: [], note: 'no mineable reports matched the issue filter' };
  }

  const lessons = loadCurrentLessons();
  const userContent = selfAuditAgent.buildUserContent({ lessons, reports });

  const result = await runAgent(selfAuditAgent, {
    messages: [{ role: 'user', content: userContent }],
    tracking: { service: 'knowledge.selfAudit.v1' },
  });

  const parsed = result.parsed;
  if (!parsed || !Array.isArray(parsed.proposals)) {
    return {
      ok: false,
      dryRun,
      scanned: reports.length,
      error: 'agent returned no parsable proposals',
      parseError: result.parseError || null,
      rawSample: (result.text || '').slice(0, 400),
    };
  }

  const proposalIds = [];
  const skipped = [];
  const errors = [];

  // Validation references: the set of REAL report ids we actually scanned (so a
  // manipulated report can't fabricate evidence), plus the causes already
  // pending in the review queue from earlier runs (cross-run dedupe).
  const reportIdSet = new Set(reports.map(r => String(r.id)));
  const pendingKeys = pendingCauseKeys();

  for (const p of parsed.proposals.slice(0, MAX_PROPOSALS)) {
    if (!p || !ALLOWED.has(p.section)) { skipped.push({ reason: 'invalid section', section: p && p.section }); continue; }

    // cause/prevention MUST be real strings — never coerce an object into
    // "[object Object]" and enqueue it.
    if (typeof p.cause !== 'string' || typeof p.prevention !== 'string') {
      skipped.push({ reason: 'cause/prevention not a string', section: p.section }); continue;
    }
    const cause = p.cause.trim();
    const prevention = p.prevention.trim();
    if (!cause || !prevention) { skipped.push({ reason: 'empty cause/prevention', section: p.section }); continue; }

    // Evidence must be >=2 DISTINCT ids that actually exist in the batch we
    // scanned. Anything else is unsupported (or fabricated) — drop it.
    const evidence = Array.isArray(p.evidence)
      ? [...new Set(p.evidence.map(String))].filter(id => reportIdSet.has(id))
      : [];
    if (evidence.length < 2) { skipped.push({ reason: 'insufficient real evidence', cause, evidence }); continue; }

    if (isDuplicateCause(lessons, p.section, cause)) { skipped.push({ reason: 'already captured', cause }); continue; }
    const key = `${p.section}::${normalizeCause(cause)}`;
    if (pendingKeys.has(key)) { skipped.push({ reason: 'already pending in queue', cause }); continue; }

    // Clamp confidence into [0,1]; null if it isn't a finite number.
    const confidence = (typeof p.confidence === 'number' && isFinite(p.confidence))
      ? Math.min(Math.max(p.confidence, 0), 1)
      : null;

    if (dryRun) { proposalIds.push(`(dry-run) ${p.section}: ${cause}`); continue; }

    try {
      const entry = await knowledgeWriter.propose({
        source: 'self_audit',
        op: 'add',
        target_file: TARGET_FILE,
        candidate: { section: p.section, items: [{ cause, prevention }] },
        dedupeKey: key,
        evidence: evidence.slice(0, 20),
        confidence,
        rationale: typeof p.rationale === 'string' ? p.rationale : '',
      });
      proposalIds.push(entry.id);
      pendingKeys.add(key); // also dedupe WITHIN this same run
    } catch (e) {
      errors.push(e.message);
    }
  }

  const auditNotes = sanitizeAuditNotes(parsed.audit_notes);
  if (!dryRun && auditNotes.length) {
    try { writeAuditNotes(auditNotes); } catch (e) { errors.push(`audit_notes write failed: ${e.message}`); }
  }

  return {
    ok: true,
    dryRun,
    startedAt,
    scanned: reports.length,
    returned: parsed.proposals.length,
    proposed: proposalIds.length,
    skipped: skipped.length,
    skippedDetail: skipped,
    errors,
    proposalIds,
    auditNotes,
    usage: result.usage,
    costCents: result.agent && result.agent.costCents,
  };
}

/**
 * Optional scheduler hook for server/index.js. Env-gated and OFF by default so a
 * deploy never silently starts spending on a daily LLM job — flip it on per env.
 *   KNOWLEDGE_SELF_AUDIT_ENABLED=true
 *   KNOWLEDGE_SELF_AUDIT_INTERVAL_HOURS=24   (default 24)
 */
function schedule() {
  if (String(process.env.KNOWLEDGE_SELF_AUDIT_ENABLED).toLowerCase() !== 'true') return null;
  const hours = Math.min(Math.max(parseFloat(process.env.KNOWLEDGE_SELF_AUDIT_INTERVAL_HOURS) || 24, 1), 168);
  const intervalMs = hours * 60 * 60 * 1000;
  const tick = async () => {
    try {
      const summary = await run();
      console.log(`[knowledge.selfAudit] proposed=${summary.proposed} skipped=${summary.skipped} scanned=${summary.scanned} cost=${summary.costCents}c`);
    } catch (e) {
      console.error('[knowledge.selfAudit] run failed:', e.message);
    }
  };
  // First run 5 min after boot (let the app settle), then on the interval.
  const timer = setInterval(tick, intervalMs);
  setTimeout(tick, 5 * 60 * 1000);
  return timer;
}

module.exports = { run, schedule, loadReports, loadCurrentLessons, ISSUE_REGEX };

// CLI entry: node knowledgeSelfAuditJob.js [--dry-run] [--limit=N]
if (require.main === module) {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const limArg = argv.find(a => a.startsWith('--limit='));
  const limit = limArg ? parseInt(limArg.split('=')[1], 10) : undefined;
  run({ dryRun, limit })
    .then(s => { console.log(JSON.stringify(s, null, 2)); process.exit(s.ok ? 0 : 1); })
    .catch(e => { console.error('FATAL:', e.message); process.exit(1); });
}
