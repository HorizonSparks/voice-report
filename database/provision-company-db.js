/**
 * Per-company database provisioning.
 *
 * Creates a dedicated database for a company, applies the voicereport schema, registers it in the
 * company_databases registry (in the shared/horizon DB), and refreshes the pool-router so the
 * company is immediately routed to its own DB. Idempotent — safe to re-run.
 *
 * This is the "give each company its own database" pipeline. It fixes the cross-company information
 * bleeding by physically separating each company's operational data. Platform data (the company
 * registry, billing, sessions) stays in the shared DB; this only provisions the per-company stores.
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const PG_BASE = {
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
};
const SHARED_DB = process.env.PG_DATABASE;

/** Derive a safe physical database name from a company id: horizon_<sanitized id>. */
function dbNameFor(companyId) {
  const safe = String(companyId).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50);
  return 'horizon_' + (safe || 'company');
}

/** Run a query against the shared/admin DB (for CREATE DATABASE + registry ops). */
async function adminQuery(sql, params) {
  const pool = new Pool({ ...PG_BASE, database: SHARED_DB });
  try { return await pool.query(sql, params); }
  finally { await pool.end(); }
}

/** Ensure the registry table exists in the shared DB. */
async function ensureRegistry() {
  await adminQuery(`CREATE TABLE IF NOT EXISTS voicereport.company_databases (
    company_id TEXT PRIMARY KEY, db_name TEXT NOT NULL UNIQUE, provisioned_at TIMESTAMP DEFAULT NOW())`);
}

/**
 * Provision a dedicated database for a company.
 * @returns {Promise<{companyId,dbName,created:boolean}>}
 */
async function provisionCompanyDb(companyId, { applySchema = true } = {}) {
  if (!companyId) throw new Error('provisionCompanyDb: companyId required');
  const dbName = dbNameFor(companyId);
  await ensureRegistry();

  // 1. CREATE DATABASE (cannot run inside a transaction; check first). dbName is sanitized above.
  const exists = await adminQuery('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  const created = exists.rowCount === 0;
  if (created) await adminQuery(`CREATE DATABASE ${dbName}`);

  // 2. Apply the voicereport schema to the new DB (idempotent). The app's runtime ensureSchema also
  //    backfills anything missing on first use, so this is belt-and-suspenders.
  if (applySchema) {
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const sql = fs.readFileSync(schemaPath, 'utf8');
      const pool = new Pool({ ...PG_BASE, database: dbName });
      try {
        await pool.query('CREATE SCHEMA IF NOT EXISTS voicereport');
        await pool.query("SET search_path TO voicereport");
        await pool.query(sql);
      } catch (e) {
        console.error(`[provision] schema apply warning for ${dbName}: ${e.message}`);
      } finally { await pool.end(); }
    }
  }

  // 3. Register it (shared DB) so the router knows this company has its own DB.
  await adminQuery(
    `INSERT INTO voicereport.company_databases (company_id, db_name) VALUES ($1, $2)
     ON CONFLICT (company_id) DO UPDATE SET db_name = EXCLUDED.db_name`,
    [companyId, dbName]);

  // 4. Refresh the router cache so requests route to the new DB immediately (no restart needed).
  try { await require('./pool-router').refreshCompanyDbMap(); } catch (e) { /* router optional in scripts */ }

  return { companyId, dbName, created };
}

module.exports = { provisionCompanyDb, dbNameFor, ensureRegistry };
