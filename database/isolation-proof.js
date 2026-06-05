#!/usr/bin/env node
/**
 * Per-company isolation proof / bleed-probe.
 *
 * Provisions two throwaway "probe" companies through the REAL provisionCompanyDb + pool-router and
 * asserts that each company's data is physically isolated in its own database — i.e. a request routed
 * as company A can never see company B's rows, and an unprovisioned company falls back to the shared
 * DB. This is the regression guard for the cross-company bleeding class.
 *
 * It uses the standard PG_* env vars, so it runs against whatever database is configured (a throwaway
 * local Postgres, staging, or — deliberately — prod). It only ever CREATES two empty probe databases
 * (horizon_isolation_probe_alpha / _beta), which do not affect any real company's traffic.
 *
 *   node database/isolation-proof.js            # provision probes + assert (leaves the empty probe DBs)
 *   node database/isolation-proof.js --cleanup  # same, then DROP the two probe DBs + registry rows
 *
 * --cleanup is hard-guarded to refuse dropping any database whose name does not start with
 * 'horizon_isolation_probe_' — it can never touch a real tenant or the shared DB.
 */
const { Pool } = require('pg');
const { provisionCompanyDb, dbNameFor } = require('./provision-company-db');
const router = require('./pool-router');

const PROBES = ['isolation_probe_alpha', 'isolation_probe_beta'];
const PROBE_PREFIX = 'horizon_isolation_probe_';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function adminQuery(sql, params) {
  const pool = new Pool({
    host: process.env.PG_HOST, port: process.env.PG_PORT, user: process.env.PG_USER,
    password: process.env.PG_PASSWORD, database: process.env.PG_DATABASE,
  });
  try { return await pool.query(sql, params); } finally { await pool.end(); }
}

async function cleanup() {
  for (const id of PROBES) {
    const db = dbNameFor(id);
    if (!db.startsWith(PROBE_PREFIX)) { console.log(`  refusing to drop non-probe DB: ${db}`); continue; }
    try {
      await adminQuery(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
      await adminQuery('DELETE FROM voicereport.company_databases WHERE company_id = $1', [id]);
      console.log(`  dropped ${db} + registry row`);
    } catch (e) { console.log(`  cleanup warning for ${db}: ${e.message}`); }
  }
}

(async () => {
  const doCleanup = process.argv.includes('--cleanup');
  console.log('Provisioning two probe companies through the real pipeline…');
  const a = await provisionCompanyDb(PROBES[0]);
  const b = await provisionCompanyDb(PROBES[1]);
  console.log(`  alpha → ${a.dbName}   beta → ${b.dbName}`);

  console.log('\nASSERTIONS:');
  const poolA = router.getCompanyPool(PROBES[0]);
  const poolB = router.getCompanyPool(PROBES[1]);
  const dbA = (await poolA.query('SELECT current_database() AS db')).rows[0].db;
  const dbB = (await poolB.query('SELECT current_database() AS db')).rows[0].db;
  check('alpha routes to its own DB', dbA === dbNameFor(PROBES[0]), `current_database()=${dbA}`);
  check('beta routes to its own DB', dbB === dbNameFor(PROBES[1]), `current_database()=${dbB}`);
  check('two companies on different physical databases', dbA !== dbB, `${dbA} != ${dbB}`);

  await poolA.query("INSERT INTO companies (id, name) VALUES ('c_alpha','ALPHA-SECRET-7f3a') ON CONFLICT (id) DO NOTHING");
  await poolB.query("INSERT INTO companies (id, name) VALUES ('c_beta','BETA-SECRET-9d1c') ON CONFLICT (id) DO NOTHING");
  const aSees = (await poolA.query('SELECT name FROM companies')).rows.map(r => r.name);
  const bSees = (await poolB.query('SELECT name FROM companies')).rows.map(r => r.name);
  check('alpha sees its own secret', aSees.includes('ALPHA-SECRET-7f3a'));
  check("alpha CANNOT see beta's secret (no bleed)", !aSees.includes('BETA-SECRET-9d1c'));
  check('beta sees its own secret', bSees.includes('BETA-SECRET-9d1c'));
  check("beta CANNOT see alpha's secret (no bleed)", !bSees.includes('ALPHA-SECRET-7f3a'));

  const poolG = router.getCompanyPool('unprovisioned_gamma');
  const dbG = (await poolG.query('SELECT current_database() AS db')).rows[0].db;
  check('unprovisioned company falls back to shared DB', dbG === process.env.PG_DATABASE, `current_database()=${dbG}`);

  if (doCleanup) { console.log('\nCleanup (probe DBs only):'); await router.closeAll(); await cleanup(); }
  else { await router.closeAll(); }

  const failed = results.filter(r => !r.pass);
  console.log(`\n${failed.length === 0 ? 'ALL ' + results.length + ' ASSERTIONS PASSED — physical isolation proven, zero bleed.' : failed.length + ' FAILED'}`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => { console.error('PROOF ERROR:', e.message); process.exit(2); });
