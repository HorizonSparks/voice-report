/**
 * Per-tenant semantic report memory (Phase 3 — RD2's real memory).
 *
 * Reports are chunked + embedded (OpenAI) and stored in report_memory, STAMPED with the
 * owning company_id + person_id. Retrieval (recall) re-applies the SAME walls that govern
 * reports — company + the see-down visible set — in SQL, BEFORE ranking by meaning. So the
 * memory can NEVER surface a report the actor could not already see. This is the deliberate
 * fix for the agent_insights cross-tenant trap.
 *
 * No pgvector: embeddings are stored as JSON and cosine is computed in-app over the already
 * wall-filtered (and recency-capped) candidate set. pgvector is a later speed optimization.
 */
const DB = require('../../database/db');
const openai = require('./ai/openaiClient');

const _ensured = new WeakSet(); // per-pool schema guard (GC-safe)

async function ensureSchema(db) {
  const DBH = db || DB;
  const pool = DBH.db; // the raw pg pool
  if (pool && _ensured.has(pool)) return;
  await DBH.db.query(`
    CREATE TABLE IF NOT EXISTS report_memory (
      id BIGSERIAL PRIMARY KEY,
      report_id TEXT NOT NULL,
      company_id TEXT,
      person_id TEXT,
      project_id TEXT,
      chunk_index INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL,
      embedding TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
  await DBH.db.query('CREATE INDEX IF NOT EXISTS idx_report_memory_company ON report_memory(company_id)');
  await DBH.db.query('CREATE INDEX IF NOT EXISTS idx_report_memory_person ON report_memory(person_id)');
  await DBH.db.query('CREATE INDEX IF NOT EXISTS idx_report_memory_report ON report_memory(report_id)');
  if (pool) _ensured.add(pool);
}

// Split report text into paragraph-aware chunks; bounded so one huge report can't explode.
function chunkText(text, maxLen = 800, maxChunks = 12) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return [];
  const paras = t.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const chunks = [];
  let cur = '';
  for (const p of paras) {
    if (cur && (cur.length + 2 + p.length) > maxLen) { chunks.push(cur); cur = ''; }
    cur = cur ? cur + '\n\n' + p : p;
    while (cur.length > maxLen) { chunks.push(cur.slice(0, maxLen)); cur = cur.slice(maxLen); }
    if (chunks.length >= maxChunks) break;
  }
  if (cur && chunks.length < maxChunks) chunks.push(cur);
  return chunks.slice(0, maxChunks);
}

function cosineSim(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return -1;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return -1;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Index (or re-index) ONE report. Idempotent by report_id (delete + re-insert chunks).
// company_id is stamped from the report or derived from the owning person — NEVER missing on
// purpose; a row with a null company_id is unreachable by non-admin recall (fail closed).
async function indexReport(db, report, opts = {}) {
  const DBH = db || DB;
  const reportId = report && report.id;
  if (!reportId) return { indexed: 0 };
  await ensureSchema(DBH);
  const personId = report.person_id || null;
  let companyId = report.company_id || null;
  if (!companyId && personId) {
    try {
      const { rows } = await DBH.db.query('SELECT company_id FROM people WHERE id = $1', [personId]);
      if (rows[0]) companyId = rows[0].company_id;
    } catch (e) { /* leave null — recall fails closed on null company for non-admins */ }
  }
  const source = report.markdown_structured || report.markdown_verbatim || report.transcript_raw || '';
  const chunks = chunkText(source);
  await DBH.db.query('DELETE FROM report_memory WHERE report_id = $1', [reportId]);
  if (chunks.length === 0) return { indexed: 0 };
  const vecs = await openai.embed(chunks, { requestId: opts.requestId, personId });
  let n = 0;
  for (let i = 0; i < chunks.length && i < vecs.length; i++) {
    await DBH.db.query(
      `INSERT INTO report_memory (report_id, company_id, person_id, project_id, chunk_index, content, embedding, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW()))`,
      [reportId, companyId, personId, report.project_id || null, i, chunks[i], JSON.stringify(vecs[i]), report.created_at || null]
    );
    n++;
  }
  return { indexed: n };
}

async function removeReport(db, reportId) {
  if (!reportId) return;
  await (db || DB).db.query('DELETE FROM report_memory WHERE report_id = $1', [reportId]);
}

/**
 * Walled semantic recall. authContext = { person_id, company_id, is_admin, visiblePersonIds }.
 * THE WALL (company + see-down) is applied in SQL before ranking; fails CLOSED.
 */
async function recall(db, authContext = {}, query, opts = {}) {
  const DBH = db || DB;
  const isAdmin = !!authContext.is_admin;
  const companyId = authContext.company_id || null;
  const visibleIds = Array.isArray(authContext.visiblePersonIds) ? authContext.visiblePersonIds : [];
  // Fail closed: EVERY recall is company-scoped (even admins must have a target company, so a
  // null-company admin session can't global-scan), and a non-admin also needs a see-down set.
  if (!companyId) return [];
  if (!isAdmin && visibleIds.length === 0) return [];
  if (!query || !String(query).trim()) return [];
  await ensureSchema(DBH);

  const params = [];
  let sql = 'SELECT report_id, person_id, project_id, content, embedding, created_at FROM report_memory WHERE 1=1';
  if (companyId) { params.push(companyId); sql += ` AND company_id = $${params.length}`; }
  if (!isAdmin) { params.push(visibleIds); sql += ` AND person_id = ANY($${params.length})`; } // the see-down wall
  // Project axis (strict): non-cross-project actors (below the PM/CEO tier) only recall reports on
  // their own projects; reports with no real project (null/'default') fall through to the chain.
  // Admins + the PM/CEO tier (canCrossProject) are cross-project.
  if (!isAdmin && !authContext.canCrossProject) {
    const projIds = Array.isArray(authContext.accessibleProjectIds) ? authContext.accessibleProjectIds : [];
    params.push(projIds);
    sql += ` AND (project_id IS NULL OR project_id = 'default' OR project_id = ANY($${params.length}))`;
  }
  const candCap = Math.min(opts.candidateCap || 500, 2000);
  params.push(candCap);
  sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
  const { rows } = await DBH.db.query(sql, params);
  if (rows.length === 0) return [];

  const vecs = await openai.embed([String(query)], { requestId: opts.requestId, personId: authContext.person_id });
  const qvec = vecs && vecs[0];
  if (!qvec) return [];

  const scored = [];
  for (const r of rows) {
    let vec;
    try { vec = JSON.parse(r.embedding); } catch (e) { continue; }
    scored.push({
      report_id: r.report_id, person_id: r.person_id, project_id: r.project_id,
      content: r.content, created_at: r.created_at, score: cosineSim(qvec, vec),
    });
  }
  scored.sort((a, b) => b.score - a.score);
  const k = Math.min(opts.k || 6, 20);
  return scored.slice(0, k);
}

module.exports = { ensureSchema, chunkText, cosineSim, indexReport, removeReport, recall };
