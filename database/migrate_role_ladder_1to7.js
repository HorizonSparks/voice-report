/**
 * Role ladder renumber 1->7 — DATA migration (2026-06-06).
 * Inserts "General Foreman" at level 4, so every existing role_level >= 4 shifts +1
 * (4->5 superintendent, 5->6 admin/PM, 6->7 CEO). Levels 1/2/3 are unchanged.
 * Runs on the SHARED login DB and EVERY per-company DB. IDEMPOTENT via a per-DB marker
 * in voicereport.schema_migrations. No secret values printed.
 *
 * LIVE:
 *   ssh -i ~/.ssh/horizon_aws.pem ubuntu@100.100.206.23 \
 *     "docker exec -i voice-report-app-1 node" < ~/migrate_role_ladder_1to7.js
 * DRY RUN (report only, no writes):
 *   ssh ... "docker exec -e DRY=1 -i voice-report-app-1 node" < ~/migrate_role_ladder_1to7.js
 */
const DB = require('./database/db');
const MIGRATION_ID = 'role_ladder_1to7_2026_06_06';
const DRY = process.env.DRY === '1';

async function migratePool(label, pool) {
  try {
    const pre = await pool.query(
      'SELECT role_level, COUNT(*)::int n FROM people WHERE role_level >= 4 GROUP BY role_level ORDER BY role_level'
    );
    const summary = pre.rows.map((r) => 'L' + r.role_level + 'x' + r.n).join(',') || 'none';

    // DRY mode = purely read-only: no table creation, no marker, no UPDATE.
    if (DRY) { console.log('  ' + label + ': DRY — would bump ' + summary + ' (each +1)'); return; }

    await pool.query(
      'CREATE TABLE IF NOT EXISTS voicereport.schema_migrations ' +
      '(id text PRIMARY KEY, applied_at timestamptz DEFAULT now())'
    );
    const done = await pool.query('SELECT 1 FROM voicereport.schema_migrations WHERE id = $1', [MIGRATION_ID]);
    if (done.rows.length) { console.log('  ' + label + ': already applied (skip)'); return; }

    await pool.query('BEGIN');
    const upd = await pool.query('UPDATE people SET role_level = role_level + 1 WHERE role_level >= 4');
    await pool.query('INSERT INTO voicereport.schema_migrations (id) VALUES ($1)', [MIGRATION_ID]);
    await pool.query('COMMIT');
    console.log('  ' + label + ': bumped ' + upd.rowCount + ' row(s) [was ' + summary + ']');
  } catch (e) {
    try { await pool.query('ROLLBACK'); } catch (_) {}
    console.log('  ' + label + ': ERROR ' + e.message);
  }
}

(async () => {
  console.log('Role ladder 1->7 migration ' + (DRY ? '(DRY RUN)' : '(LIVE)'));
  await migratePool('SHARED', DB.db);
  try {
    const pr = require('./database/pool-router');
    if (process.env.USE_COMPANY_DBS === 'true') {
      await pr.refreshCompanyDbMap();
      const map = pr.getCompanyDbMap();
      for (const cid of Object.keys(map)) {
        await migratePool('COMPANY ' + cid, pr.getCompanyPool(cid));
      }
    } else {
      console.log('(USE_COMPANY_DBS != true — shared only)');
    }
  } catch (e) { console.log('per-company enumeration skipped: ' + e.message); }
  console.log('Done.');
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(9); });
