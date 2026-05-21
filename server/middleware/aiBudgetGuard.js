'use strict';

/**
 * Daily AI budget cap per company. Reads cumulative spending from
 * voicereport.analytics_ai_costs for the current calendar day; if it
 * exceeds AI_DAILY_COST_CAP_USD, returns 429 so the route handler
 * never reaches Claude.
 *
 * Mount AFTER aiCostGuard so the cheap per-user request-rate check
 * fires first; this middleware does a DB query (cached 60s) and is
 * only worth it for requests that already passed the rate limit.
 *
 * Set AI_DAILY_COST_CAP_USD=0 to disable.
 *
 * Cache strategy: per-company { cents_today, fetched_at } in-memory.
 * 60s refresh window means at most 60s of overage past the cap before
 * the next request sees the updated total. Trade-off: a runaway script
 * during that window can spend up to ~$N more, where N depends on
 * call frequency × cost-per-call. For a 60-call/min cap × $0.01/call
 * worst case = ~$0.60 of slop. Acceptable.
 */

const DB = require('../../database/db');

const AI_DAILY_CAP_USD = parseFloat(process.env.AI_DAILY_COST_CAP_USD || '100');
const AI_DAILY_CAP_CENTS = Math.round(AI_DAILY_CAP_USD * 100);
const REFRESH_MS = 60 * 1000;

// Map<company_id, { cents_today, fetched_at }>
const cache = new Map();

async function getCompanyCostCentsToday(company_id) {
  if (!company_id) return 0;
  const cached = cache.get(company_id);
  const now = Date.now();
  if (cached && (now - cached.fetched_at) < REFRESH_MS) {
    return cached.cents_today;
  }
  try {
    const { rows } = await DB.db.query(
      `SELECT COALESCE(SUM(estimated_cost_cents), 0)::int AS cents
         FROM voicereport.analytics_ai_costs
        WHERE company_id = $1
          AND created_at::date = (NOW() AT TIME ZONE 'UTC')::date`,
      [company_id]
    );
    const cents = rows[0] ? rows[0].cents : 0;
    cache.set(company_id, { cents_today: cents, fetched_at: now });
    return cents;
  } catch (err) {
    // Fail OPEN — never block legit traffic on a DB hiccup. The 24h
    // analytics rollup will catch any overage after the fact.
    console.error('[aiBudgetGuard] cost lookup failed', { err: err.message, company_id });
    return 0;
  }
}

async function aiBudgetGuard(req, res, next) {
  if (AI_DAILY_CAP_CENTS <= 0) return next();
  if (!req.auth) return next();
  const company_id = req.auth.company_id;
  if (!company_id) return next(); // unattributed traffic doesn't burn a per-company budget

  const usedCents = await getCompanyCostCentsToday(company_id);
  if (usedCents >= AI_DAILY_CAP_CENTS) {
    return res.status(429).json({
      error: 'Daily AI budget exceeded for ' + company_id,
      used_usd: +(usedCents / 100).toFixed(2),
      cap_usd: AI_DAILY_CAP_USD,
      resets_at: 'midnight UTC',
    });
  }
  next();
}

// Helper used by /api/analytics/ai-budget to surface current usage without
// burning a Claude call. Same cache.
async function getBudgetSnapshot(company_id) {
  if (!company_id) return null;
  const cents = await getCompanyCostCentsToday(company_id);
  return {
    company_id,
    used_usd: +(cents / 100).toFixed(4),
    cap_usd: AI_DAILY_CAP_USD,
    cap_enabled: AI_DAILY_CAP_CENTS > 0,
    pct_used: AI_DAILY_CAP_CENTS > 0 ? Math.round((cents / AI_DAILY_CAP_CENTS) * 1000) / 10 : null,
  };
}

module.exports = { aiBudgetGuard, getBudgetSnapshot, AI_DAILY_CAP_USD };
