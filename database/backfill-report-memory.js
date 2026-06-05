// Backfill: embed existing reports into the per-tenant report_memory (Phase 3).
// Idempotent — indexReport() deletes + re-inserts a report's chunks, so re-runs are safe.
//
//   Dry run (default, no embeds/writes):  node database/backfill-report-memory.js
//   Commit:                               node database/backfill-report-memory.js --commit
//   Scoped:                               node database/backfill-report-memory.js --commit --company <id> --limit 500
//
// COST NOTE: --commit calls the OpenAI embeddings API for every report's chunks. Run scoped
// first (one company) to sanity-check before a full backfill.
const DB = require('./db');
const reportMemory = require('../server/services/reportMemory');

const COMMIT = process.argv.includes('--commit');
function argVal(flag) { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; }
const company = argVal('--company');
const limit = parseInt(argVal('--limit') || '100000', 10);

async function main() {
  await reportMemory.ensureSchema(DB);
  let sql = `SELECT id, person_id, company_id, project_id, markdown_structured, markdown_verbatim,
             transcript_raw, created_at FROM reports WHERE 1=1`;
  const params = [];
  if (company) { params.push(company); sql += ` AND company_id = $${params.length}`; }
  sql += ' ORDER BY created_at DESC';
  params.push(limit); sql += ` LIMIT $${params.length}`;
  const { rows } = await DB.db.query(sql, params);
  console.log(`${COMMIT ? 'COMMIT' : 'DRY-RUN'}: ${rows.length} report(s)${company ? ' for company ' + company : ''}.`);

  let indexed = 0, chunks = 0, skipped = 0;
  for (const r of rows) {
    const hasText = String(r.markdown_structured || r.markdown_verbatim || r.transcript_raw || '').trim();
    if (!hasText) { skipped++; continue; }
    if (!COMMIT) { indexed++; continue; }
    try { const res = await reportMemory.indexReport(DB, r); chunks += res.indexed; indexed++; }
    catch (e) { console.warn(`  ! ${r.id}: ${e.message}`); }
    if (indexed % 25 === 0 && indexed) console.log(`  ...${indexed} indexed`);
  }
  console.log(`Done: ${indexed} ${COMMIT ? 'indexed' : 'would index'} (${chunks} chunks), ${skipped} empty-skipped.`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
