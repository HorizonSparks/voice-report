/**
 * Billing API Routes — Plans, Subscriptions, Invoices
 * All routes require Sparks admin or support role.
 */
const { Router } = require('express');
const crypto = require('crypto');
const DB = require('../../database/db');
const { requireAuth, requireSparksRole } = require('../middleware/sessionAuth');

const router = Router();

router.use(requireAuth);

// ============================================
// PLANS
// ============================================

// GET /api/billing/plans — list all active plans
router.get('/plans', requireSparksRole('support'), async (req, res) => {
  try {
    const plans = await DB.plans.getAll();
    res.json(plans);
  } catch (err) {
    console.error('Billing plans error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// COMPANY BILLING
// ============================================

// GET /api/billing/company/:companyId — subscription + invoices
router.get('/company/:companyId', requireSparksRole('support'), async (req, res) => {
  try {
    const subscription = await DB.subscriptions.getByCompanyId(req.params.companyId);
    const invoices = await DB.invoices.getByCompanyId(req.params.companyId);
    res.json({ subscription, invoices });
  } catch (err) {
    console.error('Company billing error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/billing/company/:companyId/subscribe — assign a plan
router.post('/company/:companyId/subscribe', requireSparksRole('admin'), async (req, res) => {
  try {
    const { plan_id } = req.body;
    if (!plan_id) return res.status(400).json({ error: 'plan_id required' });

    const plan = await DB.plans.getById(plan_id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    // Cancel any existing active subscription
    const existing = await DB.subscriptions.getByCompanyId(req.params.companyId);
    if (existing) {
      await DB.subscriptions.cancel(existing.id);
    }

    // Create new subscription
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const sub = await DB.subscriptions.create({
      id: 'sub_' + crypto.randomUUID().split('-')[0],
      company_id: req.params.companyId,
      plan_id,
      status: 'active',
      started_at: now,
      current_period_start: now,
      current_period_end: periodEnd,
      next_billing_date: periodEnd,
    });

    // Audit
    await DB.db.query(`
      INSERT INTO sparks_audit_log (id, person_id, action, resource_type, resource_id, details, created_at)
      VALUES ($1, $2, 'subscribed_plan', 'company', $3, $4, NOW())
    `, [crypto.randomUUID(), req.auth.person_id, req.params.companyId, JSON.stringify({ plan_id, plan_name: plan.name })]);

    res.json(sub);
  } catch (err) {
    console.error('Subscribe error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/billing/company/:companyId/cancel — cancel subscription
router.post('/company/:companyId/cancel', requireSparksRole('admin'), async (req, res) => {
  try {
    const sub = await DB.subscriptions.getByCompanyId(req.params.companyId);
    if (!sub) return res.status(404).json({ error: 'No active subscription' });

    await DB.subscriptions.cancel(sub.id);

    // Audit
    await DB.db.query(`
      INSERT INTO sparks_audit_log (id, person_id, action, resource_type, resource_id, details, created_at)
      VALUES ($1, $2, 'cancelled_subscription', 'company', $3, $4, NOW())
    `, [crypto.randomUUID(), req.auth.person_id, req.params.companyId, JSON.stringify({ plan_id: sub.plan_id })]);

    res.json({ success: true, cancelled_at: new Date() });
  } catch (err) {
    console.error('Cancel error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/billing/company/:companyId/invoice — create manual invoice
router.post('/company/:companyId/invoice', requireSparksRole('admin'), async (req, res) => {
  try {
    const { amount_cents, description, due_date } = req.body;
    if (!amount_cents || !description || !due_date) {
      return res.status(400).json({ error: 'amount_cents, description, and due_date required' });
    }

    const sub = await DB.subscriptions.getByCompanyId(req.params.companyId);
    if (!sub) return res.status(404).json({ error: 'No active subscription' });

    const invoice = await DB.invoices.create({
      id: 'inv_' + crypto.randomUUID().split('-')[0],
      company_id: req.params.companyId,
      subscription_id: sub.id,
      amount_cents: parseInt(amount_cents),
      description,
      due_date,
    });

    // Audit
    await DB.db.query(`
      INSERT INTO sparks_audit_log (id, person_id, action, resource_type, resource_id, details, created_at)
      VALUES ($1, $2, 'created_invoice', 'company', $3, $4, NOW())
    `, [crypto.randomUUID(), req.auth.person_id, req.params.companyId, JSON.stringify({ amount_cents, description })]);

    res.json(invoice);
  } catch (err) {
    console.error('Create invoice error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/billing/invoice/:invoiceId/pay — mark invoice as paid
router.post('/invoice/:invoiceId/pay', requireSparksRole('admin'), async (req, res) => {
  try {
    await DB.invoices.markPaid(req.params.invoiceId);

    // Audit
    await DB.db.query(`
      INSERT INTO sparks_audit_log (id, person_id, action, resource_type, resource_id, details, created_at)
      VALUES ($1, $2, 'marked_invoice_paid', 'invoice', $3, $4, NOW())
    `, [crypto.randomUUID(), req.auth.person_id, req.params.invoiceId, JSON.stringify({})]);

    res.json({ success: true, paid_at: new Date() });
  } catch (err) {
    console.error('Pay invoice error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/billing/revenue — MRR summary
router.get('/revenue', requireSparksRole('support'), async (req, res) => {
  try {
    // Total MRR from active subscriptions (per-person pricing)
    const { rows: mrrRows } = await DB.db.query(`
      SELECT 
        COALESCE(SUM(p.price_cents * (SELECT count(*) FROM people pe WHERE pe.company_id = cs.company_id)), 0)::int as mrr_cents,
        count(*)::int as active_count
      FROM company_subscriptions cs
      JOIN plans p ON cs.plan_id = p.id
      WHERE cs.status = 'active'
    `);

    // Count by plan with per-company details
    const { rows: byPlan } = await DB.db.query(`
      SELECT p.name as plan_name, p.price_cents, count(*)::int as count,
        SUM((SELECT count(*) FROM people pe WHERE pe.company_id = cs.company_id))::int as total_people
      FROM company_subscriptions cs
      JOIN plans p ON cs.plan_id = p.id
      WHERE cs.status = 'active'
      GROUP BY p.name, p.price_cents
      ORDER BY p.price_cents
    `);

    // Past due count
    const { rows: pastDue } = await DB.db.query(`
      SELECT count(*)::int as count
      FROM company_subscriptions
      WHERE status = 'past_due'
    `);

    res.json({
      mrr_cents: mrrRows[0].mrr_cents,
      active_subscriptions: mrrRows[0].active_count,
      by_plan: byPlan,
      past_due_count: pastDue[0].count,
    });
  } catch (err) {
    console.error('Revenue error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
