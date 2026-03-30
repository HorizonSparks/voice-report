-- ============================================
-- Docker Init — Creates company databases & applies schemas
-- Runs after postgres-schema.sql (01-schema.sql) on the main 'horizon' DB
-- Mount as /docker-entrypoint-initdb.d/02-docker-init.sql
-- ============================================

-- ============================================
-- 1. Billing tables (on main horizon DB)
-- ============================================
SET search_path TO voicereport;

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  billing_cycle TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'annual')),
  max_trades INTEGER NOT NULL DEFAULT 1,
  max_people INTEGER NOT NULL DEFAULT 25,
  max_projects INTEGER NOT NULL DEFAULT 3,
  includes_ai BOOLEAN NOT NULL DEFAULT FALSE,
  includes_forms BOOLEAN NOT NULL DEFAULT TRUE,
  includes_relation_data BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS company_subscriptions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  plan_id TEXT NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('active', 'past_due', 'cancelled', 'trial')),
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  next_billing_date TIMESTAMP,
  cancelled_at TIMESTAMP,
  stripe_subscription_id TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  subscription_id TEXT NOT NULL REFERENCES company_subscriptions(id),
  amount_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('paid', 'pending', 'overdue', 'void')),
  description TEXT,
  due_date TIMESTAMP NOT NULL,
  paid_at TIMESTAMP,
  stripe_invoice_id TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Seed plans
INSERT INTO plans (id, name, price_cents, billing_cycle, max_trades, max_people, max_projects, includes_ai, includes_forms, includes_relation_data, description, status)
VALUES
  ('plan_starter', 'Starter', 9900, 'monthly', 1, 25, 3, FALSE, TRUE, FALSE, 'Essential field reporting for small teams.', 'active'),
  ('plan_professional', 'Professional', 29900, 'monthly', 3, 100, 10, TRUE, TRUE, FALSE, 'AI-powered reporting for growing teams.', 'active'),
  ('plan_enterprise', 'Enterprise', 59900, 'monthly', 99, 9999, 999, TRUE, TRUE, TRUE, 'Full platform for large organizations.', 'active')
ON CONFLICT (id) DO NOTHING;
