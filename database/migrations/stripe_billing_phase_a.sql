-- Stripe Billing — Phase A
-- ============================================
-- Adds the missing pieces to wire Stripe consumption billing into the existing
-- billing tables (plans + company_subscriptions + invoices already exist with
-- stripe_subscription_id / stripe_invoice_id columns ready).
--
-- What this migration does:
--   1. Add companies.stripe_customer_id — maps our company → Stripe cus_*
--   2. Add analytics_ai_costs.company_id — was being passed by routes but
--      DROPPED by trackAiCost INSERT. Per-company cost rollups require it.
--   3. Add analytics_ai_costs.billing_synced_at — marks rows already reported
--      to Stripe as meter events. NULL = pending, timestamp = synced.
--   4. Partial index for fast "what's pending billing sync" queries.
--
-- Safe to re-run: all guards use IF NOT EXISTS.

SET search_path TO voicereport;

-- 1) companies.stripe_customer_id
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
CREATE INDEX IF NOT EXISTS idx_companies_stripe_customer
  ON companies(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- 2) analytics_ai_costs.company_id (was being silently dropped)
ALTER TABLE analytics_ai_costs
  ADD COLUMN IF NOT EXISTS company_id TEXT;

-- 3) analytics_ai_costs.billing_synced_at (NULL = pending sync to Stripe)
ALTER TABLE analytics_ai_costs
  ADD COLUMN IF NOT EXISTS billing_synced_at TIMESTAMP;

-- 4) Partial index — fast "what's unsynced for billing" lookups.
--    Filtered to non-null company_id (rows without a company can't be billed).
CREATE INDEX IF NOT EXISTS idx_analytics_billing_pending
  ON analytics_ai_costs(company_id, created_at)
  WHERE billing_synced_at IS NULL AND company_id IS NOT NULL;
