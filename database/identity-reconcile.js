#!/usr/bin/env node
/**
 * Identity reconciliation watchdog.
 *
 * The per-company people roster is the SOURCE OF TRUTH; the shared people table is a login-identity
 * mirror (getByPin reads it). This probe detects — and with --heal repairs — any drift between them,
 * the safety net behind the non-atomic cross-DB dual-write in db.js.
 *
 * Drift classes:
 *   MISSING   active person in a company DB with no shared identity        → cannot log in
 *   MISMATCH  shared identity exists but pin/status/company differ         → wrong/stale credentials
 *   STALE     person inactive in company DB but shared still active        → SECURITY: could still log in
 *   ORPHAN    active shared identity whose person is absent from its company DB
 *
 *   node database/identity-reconcile.js          # report only; exit 3 if any drift (so a scheduler alarms)
 *   node database/identity-reconcile.js --heal    # re-mirror from the per-company source of truth, then report
 *
 * Exit: 0 = clean, 3 = drift found, 2 = error.
 */
const router = require('./pool-router');
const DB = require('./db');

const HEAL = process.argv.includes('--heal');

async function main() {
  await router.refreshCompanyDbMap();
  const map = router.getCompanyDbMap();                 // { company_id: db_name }
  const companies = Object.keys(map);
  const shared = router.getSharedPool();
  const drift = [];

  for (const companyId of companies) {
    const cpool = router.getCompanyPool(companyId);
    const cdb = DB.withPool(cpool);
    const { rows: people } = await cpool.query('SELECT id, pin, status, company_id FROM people');

    for (const p of people) {
      const { rows: sh } = await shared.query('SELECT id, pin, status, company_id FROM people WHERE id = $1', [p.id]);
      const s = sh[0];
      if (p.status === 'active' && !s) drift.push({ type: 'MISSING', companyId, id: p.id });
      else if (p.status === 'active' && s && (s.pin !== p.pin || s.status !== p.status || s.company_id !== p.company_id))
        drift.push({ type: 'MISMATCH', companyId, id: p.id });
      else if (p.status !== 'active' && s && s.status === 'active')
        drift.push({ type: 'STALE', companyId, id: p.id });
      if (HEAL) { try { await cdb.people._mirrorIdentityToShared(p.id); } catch (e) { console.error('heal failed for ' + p.id + ': ' + e.message); } }
    }

    // Reverse: active shared identities for this company whose person is absent from the company DB.
    const { rows: shCompany } = await shared.query("SELECT id FROM people WHERE company_id = $1 AND status = 'active'", [companyId]);
    for (const s of shCompany) {
      const present = (await cpool.query('SELECT 1 FROM people WHERE id = $1', [s.id])).rows.length > 0;
      if (!present) {
        drift.push({ type: 'ORPHAN', companyId, id: s.id });
        if (HEAL) { try { await shared.query("UPDATE people SET status = 'inactive' WHERE id = $1", [s.id]); } catch (e) {} }
      }
    }
  }

  if (drift.length === 0) { console.log('IDENTITY OK — no drift across ' + companies.length + ' company database(s).'); process.exit(0); }
  console.log('IDENTITY DRIFT — ' + drift.length + ' issue(s)' + (HEAL ? ' (healed; re-run to confirm clean)' : '') + ':');
  for (const d of drift) console.log('  ' + d.type.padEnd(9) + ' company=' + d.companyId + '  person=' + d.id);
  process.exit(3);
}
main().catch(e => { console.error('RECONCILE ERROR: ' + e.message); process.exit(2); });
