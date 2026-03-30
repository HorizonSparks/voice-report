SET search_path TO voicereport;

-- PLANS TABLE
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

-- COMPANY SUBSCRIPTIONS TABLE
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

-- INVOICES TABLE
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

-- SEED PLANS
INSERT INTO plans (id, name, price_cents, billing_cycle, max_trades, max_people, max_projects, includes_ai, includes_forms, includes_relation_data, description, status)
VALUES
  ('plan_starter', 'Starter', 9900, 'monthly', 1, 25, 3, FALSE, TRUE, FALSE, 'Essential field reporting for small teams. 1 trade, 25 people, 3 projects. Includes digital forms.', 'active'),
  ('plan_professional', 'Professional', 29900, 'monthly', 3, 100, 10, TRUE, TRUE, FALSE, 'AI-powered reporting for growing teams. 3 trades, 100 people, 10 projects. Includes AI voice and forms.', 'active'),
  ('plan_enterprise', 'Enterprise', 59900, 'monthly', 99, 9999, 999, TRUE, TRUE, TRUE, 'Full platform for large organizations. Unlimited trades, people, and projects. All features including Relation Data.', 'active')
ON CONFLICT (id) DO NOTHING;

-- SEED: Pacific Mechanical Corp with Professional plan
INSERT INTO company_subscriptions (id, company_id, plan_id, status, started_at, current_period_start, current_period_end, next_billing_date)
VALUES (
  'sub_pacific_mech_001',
  'company_pacific_mechanical',
  'plan_professional',
  'active',
  '2026-01-01T00:00:00Z',
  '2026-03-01T00:00:00Z',
  '2026-03-31T23:59:59Z',
  '2026-04-01T00:00:00Z'
) ON CONFLICT (id) DO NOTHING;

-- SEED: March 2026 paid invoice
INSERT INTO invoices (id, company_id, subscription_id, amount_cents, status, description, due_date, paid_at)
VALUES (
  'inv_pacific_mech_2026_03',
  'company_pacific_mechanical',
  'sub_pacific_mech_001',
  29900,
  'paid',
  'Professional Plan — March 2026',
  '2026-03-01T00:00:00Z',
  '2026-03-01T08:00:00Z'
) ON CONFLICT (id) DO NOTHING;
