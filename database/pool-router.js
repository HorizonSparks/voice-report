/**
 * Pool Router — manages per-company database connection pools.
 *
 * Maps company_id → database name → Pool instance.
 * Pools are created lazily on first access and cached.
 *
 * Usage:
 *   const poolRouter = require('./pool-router');
 *   const pool = poolRouter.getCompanyPool('company_pacific_mechanical');
 *   // Returns a pg Pool connected to horizon_pacific_mechanical
 *
 *   const sharedPool = poolRouter.getSharedPool();
 *   // Always returns the horizon (shared) pool
 */

const { Pool } = require('pg');

const PG_BASE = {
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
};

// Company → database name mapping.
// Loaded DYNAMICALLY from the voicereport.company_databases registry (in the shared DB) via
// refreshCompanyDbMap(). Companies NOT in the map use the shared pool (horizon).
// An EMPTY map = every company uses the shared DB = today's behavior (so this is safe to ship before
// any company is provisioned). provisionCompanyDb() inserts a row + calls refresh, so a newly
// provisioned company routes to its own DB immediately, no restart.
let COMPANY_DB_MAP = {};

const SHARED_DB = process.env.PG_DATABASE;

/**
 * Reload the company→DB map from the registry. Safe to call anytime; on any error (e.g. the registry
 * table doesn't exist yet) it leaves the map empty → everyone uses the shared DB (current behavior).
 * @returns {Promise<number>} number of companies with their own DB
 */
async function refreshCompanyDbMap() {
  try {
    const shared = getSharedPool();
    const { rows } = await shared.query('SELECT company_id, db_name FROM voicereport.company_databases');
    const next = {};
    for (const r of rows) next[r.company_id] = r.db_name;
    COMPANY_DB_MAP = next;
    return rows.length;
  } catch (e) {
    return Object.keys(COMPANY_DB_MAP).length; // registry missing/unreadable → keep current map
  }
}

// Pool cache — lazily created
const pools = new Map();

/**
 * Create a pool with voicereport search_path
 */
function createPool(database) {
  const pool = new Pool({
    ...PG_BASE,
    database,
    max: 5, // Conservative — 5 connections per company
    options: '-c search_path=voicereport',
  });
  pool.on('error', (err) => {
    console.error(`Pool error for ${database}:`, err.message);
  });
  return pool;
}

/**
 * Get the pool for a specific company.
 * Returns the shared pool if the company doesn't have a dedicated database.
 */
function getCompanyPool(companyId) {
  if (!companyId) return getSharedPool();

  const dbName = COMPANY_DB_MAP[companyId];
  if (!dbName) return getSharedPool(); // Unknown company → shared

  if (!pools.has(dbName)) {
    pools.set(dbName, createPool(dbName));
  }
  return pools.get(dbName);
}

/**
 * Get the shared/platform pool (horizon database).
 * Used for: companies, billing, analytics, sessions, templates
 */
function getSharedPool() {
  if (!pools.has(SHARED_DB)) {
    pools.set(SHARED_DB, createPool(SHARED_DB));
  }
  return pools.get(SHARED_DB);
}

/**
 * Check if a company has a dedicated database
 */
function hasCompanyDb(companyId) {
  return companyId && COMPANY_DB_MAP[companyId] !== undefined;
}

/**
 * Get all company database entries (for cross-company queries in Control Center)
 */
function getAllCompanyDbs() {
  return Object.entries(COMPANY_DB_MAP).map(([companyId, dbName]) => ({
    companyId,
    dbName,
    pool: getCompanyPool(companyId),
  }));
}

/**
 * Gracefully close all pools (for shutdown)
 */
async function closeAll() {
  for (const [name, pool] of pools) {
    try {
      await pool.end();
      console.log(`Pool closed: ${name}`);
    } catch (e) {
      console.error(`Error closing pool ${name}:`, e.message);
    }
  }
  pools.clear();
}

module.exports = {
  getCompanyPool,
  getSharedPool,
  hasCompanyDb,
  getAllCompanyDbs,
  closeAll,
  refreshCompanyDbMap,
  getCompanyDbMap: () => ({ ...COMPANY_DB_MAP }),
};
