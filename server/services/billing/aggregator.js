/**
 * Billing Aggregator (server/services/billing/aggregator.js)
 *
 * Phase A — Single-source aggregation. Reads unsynced rows from
 * analytics_ai_costs, groups by (company_id, model_tier, direction), and
 * reports the grouped totals to Stripe as meter events.
 *
 * Run this on a schedule (daily for now; cron handles it) OR via manual
 * trigger from POST /api/billing/sync (admin-only).
 *
 * Design notes:
 *   - Idempotency: each meter event has a deterministic `identifier` based
 *     on (company_id, model_tier, direction, sync_date). Re-running the same
 *     sync is a no-op in Stripe (rejected as duplicate).
 *   - Atomicity per-company: we mark rows as synced ONLY after the meter
 *     event is accepted. Failure on one company doesn't block others.
 *   - Model tier mapping: claude-opus-4-* → opus, claude-sonnet-4-* → sonnet,
 *     claude-haiku-4-* → haiku. Anything else is logged + skipped (we
 *     intentionally don't bill for unknown models).
 *   - Phase A only handles Anthropic Claude tokens. OpenAI Whisper/TTS will
 *     be added in Phase B (audio billing is a separate decision).
 *
 * Created 2026-05-15.
 */

const crypto = require('crypto');
const DB = require('../../../database/db');
const { reportMeterEvent, isStripeConfigured } = require('../stripe/client');
const { aiLogger } = require('../logger'); // server/services/logger.js

/**
 * Map a model name to the meter family for billing.
 * Returns null for unknown models (caller skips them).
 */
function modelToTier(model) {
  if (!model) return null;
  if (model.startsWith('claude-opus-4')) return 'opus';
  if (model.startsWith('claude-sonnet-4')) return 'sonnet';
  if (model.startsWith('claude-haiku-4')) return 'haiku';
  return null;
}

/**
 * Build the deterministic Stripe meter event identifier for a group of rows.
 *
 * The identifier MUST be:
 *   - SAME if the rows being synced are the same (so retries dedup at Stripe)
 *   - DIFFERENT if any new row is added to the group (so new usage is billed)
 *
 * Date-based identifiers (the obvious approach) are broken two ways:
 *   1. UPDATE-failure leaves rows pending → next-day sync uses NEW identifier
 *      → Stripe accepts as fresh event → double bill.
 *   2. Two same-day syncs over different row sets get the SAME identifier
 *      → Stripe dedups the second → new usage is lost.
 *
 * Content-hash identifier (rows actually being reported) avoids both.
 *
 * @param {string} companyId
 * @param {string} tier      'opus'|'sonnet'|'haiku'
 * @param {string} direction 'input'|'output'
 * @param {number[]} costIds  unique row ids in this aggregation group
 * @returns {string}
 */
function buildEventIdentifier(companyId, tier, direction, costIds) {
  // Sort numerically so the same set of ids always produces the same hash,
  // regardless of arrival order.
  const sorted = [...new Set(costIds)].sort((a, b) => a - b);
  const hash = crypto
    .createHash('sha256')
    .update(sorted.join(','))
    .digest('hex')
    .slice(0, 16);
  return `hs_${companyId}_${tier}_${direction}_${hash}`;
}

/**
 * Run one aggregation sweep.
 *
 * @returns {Promise<object>} - { rowsRead, eventsReported, eventsFailed,
 *                                companiesProcessed, skipped, errors }
 */
async function aggregateAndSync({ dryRun = false } = {}) {
  const startedAt = new Date();
  const stats = {
    started_at: startedAt.toISOString(),
    rows_read: 0,
    events_reported: 0,
    events_failed: 0,
    companies_processed: 0,
    rows_skipped_no_company: 0,
    rows_skipped_unknown_model: 0,
    rows_skipped_no_stripe_customer: 0,
    errors: [],
    dry_run: !!dryRun,
  };

  if (!isStripeConfigured()) {
    stats.errors.push('Stripe not configured (STRIPE_API_KEY missing)');
    return stats;
  }

  // Pull pending rows joined with the company's stripe_customer_id.
  // Filter: only rows with company_id (we can't bill without it).
  const { rows } = await DB.db.query(`
    SELECT
      c.id AS cost_id,
      c.company_id,
      c.model,
      c.input_tokens,
      c.output_tokens,
      c.created_at,
      comp.stripe_customer_id,
      comp.name AS company_name
    FROM voicereport.analytics_ai_costs c
    LEFT JOIN voicereport.companies comp ON comp.id = c.company_id
    WHERE c.billing_synced_at IS NULL
      AND c.company_id IS NOT NULL
      AND c.provider = 'anthropic'
      AND c.success = 1
    ORDER BY c.company_id, c.created_at
    LIMIT 50000
  `);
  stats.rows_read = rows.length;

  if (rows.length === 0) {
    stats.finished_at = new Date().toISOString();
    stats.duration_ms = Date.now() - startedAt.getTime();
    return stats;
  }

  // Group by (company_id, tier, direction) → { tokens, costIds[] }
  const groups = new Map(); // key: `${cid}|${tier}|${direction}` → {company_id, tier, direction, stripe_customer_id, tokens, cost_ids}

  for (const row of rows) {
    const tier = modelToTier(row.model);
    if (!tier) {
      stats.rows_skipped_unknown_model++;
      continue;
    }
    if (!row.stripe_customer_id) {
      stats.rows_skipped_no_stripe_customer++;
      continue;
    }

    // Input tokens
    if (row.input_tokens > 0) {
      const key = `${row.company_id}|${tier}|input`;
      let g = groups.get(key);
      if (!g) {
        g = {
          company_id: row.company_id,
          stripe_customer_id: row.stripe_customer_id,
          tier,
          direction: 'input',
          tokens: 0,
          cost_ids: [],
        };
        groups.set(key, g);
      }
      g.tokens += row.input_tokens;
      g.cost_ids.push(row.cost_id);
    }
    // Output tokens
    if (row.output_tokens > 0) {
      const key = `${row.company_id}|${tier}|output`;
      let g = groups.get(key);
      if (!g) {
        g = {
          company_id: row.company_id,
          stripe_customer_id: row.stripe_customer_id,
          tier,
          direction: 'output',
          tokens: 0,
          cost_ids: [],
        };
        groups.set(key, g);
      }
      g.tokens += row.output_tokens;
      g.cost_ids.push(row.cost_id);
    }
  }

  // Report each group as a meter event, then mark its rows synced on success.
  const companiesSeen = new Set();
  for (const group of groups.values()) {
    const eventName = `sparks_ai_${group.tier}_${group.direction}`;
    // Identifier reflects the actual rows being reported. Retry of the same
    // set → same identifier → Stripe dedups. New rows → new identifier.
    const identifier = buildEventIdentifier(
      group.company_id,
      group.tier,
      group.direction,
      group.cost_ids
    );

    if (dryRun) {
      stats.events_reported++; // pretend
      companiesSeen.add(group.company_id);
      continue;
    }

    try {
      await reportMeterEvent({
        eventName,
        customerId: group.stripe_customer_id,
        value: group.tokens,
        identifier,
      });
      stats.events_reported++;
      companiesSeen.add(group.company_id);

      // Mark all contributing rows synced atomically.
      await DB.db.query(
        `UPDATE voicereport.analytics_ai_costs
         SET billing_synced_at = NOW()
         WHERE id = ANY($1::int[])`,
        [group.cost_ids]
      );
    } catch (err) {
      stats.events_failed++;
      const msg = `${group.company_id}/${group.tier}/${group.direction}: ${err.message}`;
      stats.errors.push(msg);
      aiLogger.error({ msg: 'billing_sync_failed', identifier, error: err.message });
    }
  }

  // Rows without a company_id are skipped entirely. Count them for visibility.
  const { rows: noCompRows } = await DB.db.query(`
    SELECT COUNT(*)::int AS n
    FROM voicereport.analytics_ai_costs
    WHERE billing_synced_at IS NULL
      AND company_id IS NULL
      AND provider = 'anthropic'
  `);
  stats.rows_skipped_no_company = noCompRows[0].n;

  stats.companies_processed = companiesSeen.size;
  stats.finished_at = new Date().toISOString();
  stats.duration_ms = Date.now() - startedAt.getTime();
  return stats;
}

module.exports = {
  aggregateAndSync,
  modelToTier,        // exported for tests
  buildEventIdentifier, // exported for tests
};
