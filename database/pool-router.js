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
  host: process.env.PG_HOST || 'localhost',
  port: process.env.PG_PORT || 5433,
  user: process.env.PG_USER || 'horizon_spark',
  password: process.env.PG_PASSWORD || '8oS4oc2hyYhyq698CPSqXbA1',
};

// Company → database name mapping
// Companies NOT listed here use the shared pool (horizon)
const COMPANY_DB_MAP = {
  'company_pacific_mechanical': 'horizon_pacific_mechanical',
  'company_summit_electrical': 'horizon_summit_electrical',
  'company_horizon_sparks': 'horizon_sparks',
  // Add new companies here as they're onboarded
};

const SHARED_DB = process.env.PG_DATABASE || 'horizon';

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
  });
  pool.on('connect', (client) => {
    client.query('SET search_path TO voicereport');
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
  COMPANY_DB_MAP,
};
