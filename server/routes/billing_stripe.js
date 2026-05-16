/**
 * Billing Routes — Stripe wiring (added 2026-05-15)
 *
 * Two new endpoints layered on top of the existing routes/billing.js:
 *
 *   POST /api/billing/webhook   — Stripe-signed event receiver. No auth (auth
 *                                 = signature verification with shared secret).
 *                                 MUST receive the raw request body for signature
 *                                 verification, so this route uses its own
 *                                 express.raw() middleware.
 *
 *   POST /api/billing/sync      — Admin-only manual trigger for the billing
 *                                 aggregator (normally runs on a daily timer).
 *
 *   GET  /api/billing/sync/status
 *                               — Admin-only quick read: how many rows pending
 *                                 sync, last sync timestamp, etc.
 */

const express = require('express');
const DB = require('../../database/db');
const { requireAuth, requireSparksRole } = require('../middleware/sessionAuth');
const { aggregateAndSync } = require('../services/billing/aggregator');
const { constructWebhookEvent, isStripeConfigured } = require('../services/stripe/client');
const { aiLogger } = require('../services/logger');

/**
 * Build the webhook router with raw-body parsing.
 * Mount this BEFORE the global express.json() middleware in server/index.js.
 *
 * Usage in server/index.js:
 *   const { buildStripeWebhookRouter } = require('./routes/billing');
 *   app.use('/api/billing/webhook', buildStripeWebhookRouter());
 *   // ...later, after express.json()...
 *   app.use('/api/billing', require('./routes/billing'));
 */
function buildStripeWebhookRouter() {
  const router = express.Router();

  router.post(
    '/',
    express.raw({ type: 'application/json', limit: '1mb' }),
    async (req, res) => {
      if (!isStripeConfigured()) {
        return res.status(503).json({ error: 'Stripe not configured' });
      }
      const sig = req.headers['stripe-signature'];
      if (!sig) {
        return res.status(400).json({ error: 'Missing stripe-signature header' });
      }

      let event;
      try {
        event = constructWebhookEvent(req.body, sig);
      } catch (err) {
        aiLogger.warn({ msg: 'stripe_webhook_bad_signature', error: err.message });
        return res.status(400).json({ error: 'Invalid signature' });
      }

      // Handle the event types we care about. Always 200 quickly so Stripe
      // doesn't retry. Heavy processing should be queued, not done inline.
      try {
        switch (event.type) {
          case 'invoice.payment_succeeded':
          case 'invoice.paid':
            await handleInvoicePaid(event.data.object);
            break;
          case 'invoice.payment_failed':
            await handleInvoicePaymentFailed(event.data.object);
            break;
          case 'customer.subscription.created':
          case 'customer.subscription.updated':
          case 'customer.subscription.deleted':
            await handleSubscriptionChange(event.data.object);
            break;
          case 'customer.created':
          case 'customer.updated':
            // For now, log only. Customer sync will be Phase B.
            aiLogger.info({ msg: 'stripe_webhook_customer', type: event.type, id: event.data.object.id });
            break;
          default:
            aiLogger.info({ msg: 'stripe_webhook_unhandled', type: event.type, id: event.id });
        }
        res.json({ received: true, type: event.type });
      } catch (err) {
        // Stripe will retry on non-2xx. Log + 500 so it retries.
        aiLogger.error({ msg: 'stripe_webhook_handler_error', type: event.type, error: err.message });
        res.status(500).json({ error: 'Handler failed', detail: err.message });
      }
    }
  );

  return router;
}

/** Mark our local invoice row as paid when Stripe says so. */
async function handleInvoicePaid(invoice) {
  if (!invoice.id) return;
  // Find our local invoice by stripe_invoice_id and mark paid.
  await DB.db.query(
    `UPDATE voicereport.invoices
       SET status = 'paid', paid_at = NOW()
     WHERE stripe_invoice_id = $1
       AND status != 'paid'`,
    [invoice.id]
  );
  aiLogger.info({
    msg: 'invoice_marked_paid',
    stripe_invoice_id: invoice.id,
    amount_cents: invoice.amount_paid,
    customer: invoice.customer,
  });
}

/** Mark our local invoice row as overdue when payment fails. */
async function handleInvoicePaymentFailed(invoice) {
  if (!invoice.id) return;
  await DB.db.query(
    `UPDATE voicereport.invoices
       SET status = 'overdue'
     WHERE stripe_invoice_id = $1
       AND status NOT IN ('paid', 'void')`,
    [invoice.id]
  );
  aiLogger.warn({
    msg: 'invoice_payment_failed',
    stripe_invoice_id: invoice.id,
    customer: invoice.customer,
  });
}

/** Sync subscription status from Stripe to our DB.
 *  Mapping intentionally errs toward "withhold access" for any non-active state.
 *  Stripe statuses: trialing/active/past_due/canceled/unpaid/incomplete/incomplete_expired/paused
 *  Ours:            trial / active / past_due / cancelled
 */
async function handleSubscriptionChange(sub) {
  if (!sub.id) return;
  const map = {
    trialing: 'trial',
    active: 'active',
    past_due: 'past_due',
    canceled: 'cancelled',
    unpaid: 'past_due',
    // incomplete = first invoice/payment never finished. They do NOT have a
    // paid subscription — treat as past_due, NOT trial, so the entitlement
    // layer doesn't grant access.
    incomplete: 'past_due',
    incomplete_expired: 'cancelled',
    paused: 'past_due',
  };
  // Unknown Stripe status → past_due (safer than 'active' for unmapped states).
  // Log it so we know to add a mapping.
  let localStatus = map[sub.status];
  if (!localStatus) {
    aiLogger.warn({
      msg: 'unknown_stripe_subscription_status',
      stripe_status: sub.status,
      stripe_subscription_id: sub.id,
      defaulted_to: 'past_due',
    });
    localStatus = 'past_due';
  }
  await DB.db.query(
    `UPDATE voicereport.company_subscriptions
       SET status = $1, updated_at = NOW()
     WHERE stripe_subscription_id = $2`,
    [localStatus, sub.id]
  );
  aiLogger.info({
    msg: 'subscription_status_synced',
    stripe_subscription_id: sub.id,
    stripe_status: sub.status,
    local_status: localStatus,
  });
}

/**
 * Mount sync trigger + status endpoints on an existing router.
 * Called from billing.js after the existing routes are defined.
 */
function attachSyncRoutes(router) {
  router.post('/sync', requireAuth, requireSparksRole('admin'), async (req, res) => {
    try {
      const dryRun = req.query.dryRun === '1';
      const stats = await aggregateAndSync({ dryRun });
      res.json(stats);
    } catch (err) {
      aiLogger.error({ msg: 'billing_sync_route_failed', error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/sync/status', requireAuth, requireSparksRole('support'), async (req, res) => {
    try {
      const { rows: pending } = await DB.db.query(`
        SELECT
          COUNT(*) FILTER (WHERE billing_synced_at IS NULL AND company_id IS NOT NULL) AS rows_pending,
          COUNT(*) FILTER (WHERE billing_synced_at IS NULL AND company_id IS NULL)     AS rows_orphaned_no_company,
          COUNT(*) FILTER (WHERE billing_synced_at IS NOT NULL)                         AS rows_synced_total,
          MAX(billing_synced_at)                                                        AS last_sync_at
        FROM voicereport.analytics_ai_costs
        WHERE provider = 'anthropic'
      `);
      res.json({
        stripe_configured: isStripeConfigured(),
        ...pending[0],
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = {
  buildStripeWebhookRouter,
  attachSyncRoutes,
};
