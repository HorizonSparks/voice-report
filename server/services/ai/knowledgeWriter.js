/**
 * Knowledge Writer — the ONLY module permitted to mutate the knowledge/ corpus.
 *
 * Write side of the self-improvement loop. Agents (lessonMiner, selfAudit) and
 * the manual path may only PROPOSE changes into a human-review queue
 * (knowledge/_pending.json). A human (owner, via the Sparks Agent) approves, and
 * only then does applyApproved() merge the change into the target knowledge file
 * — with a timestamped backup, atomic write, schema guard, an audit-log row, and
 * an in-memory cache refresh. Nothing ever auto-writes canonical knowledge.
 *
 * Concurrency: every queue/corpus mutation runs under withLock(), which combines
 * an in-process promise chain (fast path within this Node process) with a
 * cross-process advisory file lock (knowledge/_queue.lock) so the CLI self-audit
 * job and the running server can't interleave writes. Stale locks (>30s) are
 * reclaimed.
 *
 * Test override: set HS_KNOWLEDGE_DIR to point KNOWLEDGE_DIR at a temp dir.
 */

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const KNOWLEDGE_DIR = process.env.HS_KNOWLEDGE_DIR || path.join(__dirname, '../../../knowledge');
const PENDING_FILE = path.join(KNOWLEDGE_DIR, '_pending.json');
const BACKUP_DIR = path.join(KNOWLEDGE_DIR, '_backups');
const LOCK_FILE = path.join(KNOWLEDGE_DIR, '_queue.lock');

// Hard allowlist: an approved proposal may only ever write these files.
const WRITABLE_TARGETS = new Set(['lessons_learned.json']);
const VALID_OPS = new Set(['add']);            // v1: append items to an array section
const VALID_SOURCES = new Set(['lesson_miner', 'self_audit', 'manual']);

// Lesson item schema bounds — keep canonical knowledge clean + bounded so a
// malformed/nested object can never poison lessons_learned.json or the prompts
// that consume it.
const MAX_CAUSE_CHARS = 300;
const MAX_PREVENTION_CHARS = 500;

// Cross-process advisory lock tuning.
const LOCK_STALE_MS = 30000;   // a lock file older than this is presumed abandoned
const LOCK_WAIT_MS = 10000;    // give up waiting after this long
const LOCK_POLL_MS = 100;

// ---- schema validation --------------------------------------------------

// A lesson item must be a flat {cause, prevention} object of non-empty,
// length-bounded strings — nothing else. Throws on violation; returns a trimmed
// copy on success.
function validateLessonItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('invalid lesson item: must be a plain object');
  }
  const allowed = new Set(['cause', 'prevention']);
  for (const k of Object.keys(item)) {
    if (!allowed.has(k)) throw new Error(`invalid lesson item: unexpected field "${k}"`);
  }
  if (typeof item.cause !== 'string' || !item.cause.trim()) {
    throw new Error('invalid lesson item: cause must be a non-empty string');
  }
  if (typeof item.prevention !== 'string' || !item.prevention.trim()) {
    throw new Error('invalid lesson item: prevention must be a non-empty string');
  }
  if (item.cause.length > MAX_CAUSE_CHARS) throw new Error(`invalid lesson item: cause exceeds ${MAX_CAUSE_CHARS} chars`);
  if (item.prevention.length > MAX_PREVENTION_CHARS) throw new Error(`invalid lesson item: prevention exceeds ${MAX_PREVENTION_CHARS} chars`);
  return { cause: item.cause.trim(), prevention: item.prevention.trim() };
}

// ---- low-level helpers --------------------------------------------------

function readJson(fp, fallback) {
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return fallback;
  }
}

function atomicWrite(fp, obj) {
  const tmp = `${fp}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, fp);
}

// Fail CLOSED on a corrupt queue: a missing/empty file is a legitimate empty
// queue, but an unparseable or non-array file means corruption — we refuse to
// read (and therefore refuse to overwrite) it so pending proposals aren't lost.
function loadPending() {
  if (!fs.existsSync(PENDING_FILE)) return [];
  let raw;
  try { raw = fs.readFileSync(PENDING_FILE, 'utf8'); }
  catch (e) { throw new Error(`knowledgeWriter: cannot read queue _pending.json: ${e.message}`); }
  if (raw.trim() === '') return [];
  let data;
  try { data = JSON.parse(raw); }
  catch (e) { throw new Error(`knowledgeWriter: _pending.json is CORRUPT (refusing to overwrite — fix or remove it): ${e.message}`); }
  if (!Array.isArray(data)) throw new Error('knowledgeWriter: _pending.json is not an array (refusing to overwrite)');
  return data;
}

function savePending(list) {
  atomicWrite(PENDING_FILE, list);
}

// ---- cross-process advisory file lock -----------------------------------

async function acquireFileLock() {
  try { fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true }); } catch { /* best effort */ }
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const fh = await fsp.open(LOCK_FILE, 'wx'); // exclusive create
      try { await fh.writeFile(`${process.pid} ${new Date().toISOString()}`); }
      finally { await fh.close(); }
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // Someone holds the lock. Reclaim it only if it's stale.
      let stale = false;
      try {
        const st = await fsp.stat(LOCK_FILE);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) stale = true;
      } catch { /* lock vanished between open and stat — loop and retry create */ }
      if (stale) {
        try { await fsp.unlink(LOCK_FILE); } catch { /* another waiter won the steal */ }
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error('knowledgeWriter: queue is locked by another process; try again shortly');
      }
      await new Promise(r => setTimeout(r, LOCK_POLL_MS));
    }
  }
}

async function releaseFileLock() {
  try { await fsp.unlink(LOCK_FILE); } catch { /* already gone */ }
}

// In-process serialization + cross-process file lock for every queue/corpus
// mutation. The promise chain serializes calls within THIS process cheaply; the
// file lock serializes against OTHER processes (notably the CLI self-audit job
// running while the server is up).
let _queueLock = Promise.resolve();
function withLock(fn) {
  const result = _queueLock.then(async () => {
    await acquireFileLock();
    try { return await fn(); }
    finally { await releaseFileLock(); }
  });
  _queueLock = result.then(() => {}, () => {}); // keep chain alive regardless of outcome
  return result;
}

// Dedupe semantics for merge: exact structural match after sorting OBJECT keys.
function normalize(v) {
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((o, k) => { o[k] = normalize(v[k]); return o; }, {});
  }
  return v;
}
function sameItem(a, b) {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

// ---- audit + cache (best-effort, never throw) ---------------------------

async function audit(action, personId, resourceId, details) {
  try {
    const DB = require('../../../database/db');
    const id = crypto.randomUUID();
    await DB.db.query(
      `INSERT INTO sparks_audit_log (id, person_id, action, resource_type, resource_id, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, personId || null, action, 'knowledge_proposal', resourceId || null, JSON.stringify(details || {})]
    );
  } catch (err) {
    console.warn('knowledgeWriter audit failed:', err.message);
  }
}

function refreshCache() {
  try {
    require('./knowledgeCache').reload();
  } catch (err) {
    console.warn('knowledgeWriter cache refresh failed:', err.message);
  }
}

// ---- public API ---------------------------------------------------------

/**
 * Propose a knowledge change into the human-review queue. Never writes the
 * canonical file. Returns the stored proposal (or, when a dedupeKey matches an
 * existing PENDING proposal, that existing entry — idempotent under the lock).
 *
 * @param {object} p
 * @param {string} p.source        - lesson_miner | self_audit | manual
 * @param {string} p.op            - add (v1)
 * @param {string} p.target_file   - must be in WRITABLE_TARGETS
 * @param {object} p.candidate     - { section: <arrayKey>, items: [{cause, prevention}] }
 * @param {string} [p.dedupeKey]   - if set, a pending entry with the same key is returned instead of enqueuing a duplicate
 * @param {Array}  [p.evidence]    - report ids / conversation ids backing this
 * @param {number} [p.confidence]  - 0..1
 * @param {string} [p.rationale]   - why this is proposed
 */
function propose(p) {
  return withLock(async () => {
    if (!p || typeof p !== 'object') throw new Error('propose: entry required');
    if (!VALID_SOURCES.has(p.source)) throw new Error(`propose: invalid source "${p.source}"`);
    if (!VALID_OPS.has(p.op)) throw new Error(`propose: invalid op "${p.op}"`);
    if (!WRITABLE_TARGETS.has(p.target_file)) throw new Error(`propose: target "${p.target_file}" not writable`);
    const c = p.candidate;
    if (!c || typeof c.section !== 'string' || !c.section.trim()) throw new Error('propose: candidate.section required');
    if (!Array.isArray(c.items) || c.items.length === 0) throw new Error('propose: candidate.items must be a non-empty array');
    const items = c.items.map(validateLessonItem); // throws on a malformed item

    const dedupeKey = (typeof p.dedupeKey === 'string' && p.dedupeKey.trim()) ? p.dedupeKey.trim() : null;
    const list = loadPending();
    if (dedupeKey) {
      // Re-checked HERE under the lock (not just by the caller) so two
      // overlapping runs cannot both enqueue the same lesson.
      const existing = list.find(e => e.status === 'pending' && e.dedupeKey === dedupeKey);
      if (existing) return existing;
    }

    const entry = {
      id: crypto.randomUUID(),
      source: p.source,
      op: p.op,
      target_file: p.target_file,
      candidate: { section: c.section.trim(), items },
      dedupeKey,
      evidence: Array.isArray(p.evidence) ? p.evidence : [],
      confidence: typeof p.confidence === 'number' ? p.confidence : null,
      rationale: typeof p.rationale === 'string' ? p.rationale : '',
      status: 'pending',
      created_at: new Date().toISOString(),
      decided_at: null,
      decided_by: null,
    };

    list.push(entry);
    savePending(list);
    return entry;
  });
}

/**
 * List proposals, newest first. Read-only (no lock needed — savePending uses an
 * atomic rename, so a concurrent write is seen either fully-old or fully-new).
 * @param {object} [opts] - { status, limit }
 */
function listProposals(opts = {}) {
  let list = loadPending();
  if (opts.status) list = list.filter(e => e.status === opts.status);
  list = list.slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  if (opts.limit) list = list.slice(0, opts.limit);
  return list;
}

function getProposal(id) {
  return loadPending().find(e => e.id === id) || null;
}

/**
 * Apply an approved proposal: backup -> merge -> atomic write -> mark approved ->
 * audit -> cache refresh. Only a human-confirmed path should call this.
 *
 * Crash-safety: the canonical file is written BEFORE the queue status flip. The
 * merge is idempotent (sameItem dedupe), so if the process dies between the two
 * writes the proposal is still 'pending' and a retry re-merges 0 new items and
 * completes the status flip — no double lesson, no corruption.
 *
 * @param {string} id        - proposal id
 * @param {string} approver  - person_id of the human who approved
 */
function applyApproved(id, approver) {
  return withLock(async () => {
    const list = loadPending();
    const entry = list.find(e => e.id === id);
    if (!entry) throw new Error(`applyApproved: proposal "${id}" not found`);
    if (entry.status !== 'pending') throw new Error(`applyApproved: proposal "${id}" is already ${entry.status}`);
    if (!WRITABLE_TARGETS.has(entry.target_file)) throw new Error(`applyApproved: target "${entry.target_file}" not writable`);

    const targetPath = path.join(KNOWLEDGE_DIR, entry.target_file);
    const target = readJson(targetPath, null);
    if (!target || typeof target !== 'object') throw new Error(`applyApproved: cannot read target "${entry.target_file}"`);

    // Defense in depth: re-validate every item before it touches canonical
    // knowledge, even though propose() already validated. A malformed item is
    // skipped, never merged.
    const { section, items } = entry.candidate;
    const cleanItems = [];
    for (const item of items) {
      try { cleanItems.push(validateLessonItem(item)); }
      catch (e) { console.warn(`applyApproved: skipping invalid item in ${id}: ${e.message}`); }
    }

    // Backup before any mutation.
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(BACKUP_DIR, `${entry.target_file}.${stamp}.bak`);
    fs.copyFileSync(targetPath, backupPath);

    // Merge: op 'add' -> append items to the named array section, dedupe.
    if (!Array.isArray(target[section])) {
      // Only create a new array section; never clobber a non-array value.
      if (target[section] !== undefined) throw new Error(`applyApproved: section "${section}" exists and is not an array`);
      target[section] = [];
    }
    let applied = 0, skipped = 0;
    for (const item of cleanItems) {
      if (target[section].some(existing => sameItem(existing, item))) { skipped++; continue; }
      target[section].push(item);
      applied++;
    }

    atomicWrite(targetPath, target);

    entry.status = 'approved';
    entry.decided_at = new Date().toISOString();
    entry.decided_by = approver || null;
    entry.result = { applied, skipped, backup: path.basename(backupPath) };
    savePending(list);

    await audit('knowledge_apply', approver, id, {
      target_file: entry.target_file, section, applied, skipped, backup: path.basename(backupPath),
    });
    refreshCache();

    return { ok: true, applied, skipped, target_file: entry.target_file, backup: path.basename(backupPath) };
  });
}

/**
 * Reject a pending proposal.
 */
function reject(id, approver, reason) {
  return withLock(async () => {
    const list = loadPending();
    const entry = list.find(e => e.id === id);
    if (!entry) throw new Error(`reject: proposal "${id}" not found`);
    if (entry.status !== 'pending') throw new Error(`reject: proposal "${id}" is already ${entry.status}`);
    entry.status = 'rejected';
    entry.decided_at = new Date().toISOString();
    entry.decided_by = approver || null;
    entry.reject_reason = typeof reason === 'string' ? reason : '';
    savePending(list);
    await audit('knowledge_reject', approver, id, { reason: entry.reject_reason });
    return { ok: true, status: 'rejected' };
  });
}

module.exports = {
  propose, listProposals, getProposal, applyApproved, reject,
  validateLessonItem, PENDING_FILE, KNOWLEDGE_DIR,
};
