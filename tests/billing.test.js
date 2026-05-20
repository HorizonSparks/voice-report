/**
 * BILLING ROUTE TESTS
 *
 * Exercises the surface of server/routes/billing.js without touching
 * Stripe or a real DB. Database is fully mocked so tests don't depend
 * on migrations or fixture data. Stripe is mocked at the require()
 * boundary so calls never reach the network.
 *
 * Coverage focus: auth boundaries, input validation, role gating,
 * and the contract of each endpoint (response shape). Does NOT cover
 * Stripe webhook signature verification — that lives in billing_stripe.js.
 */

const path = require('path');

// ---- Mock the DB module BEFORE requiring the billing route. ----
// billing.js uses high-level helpers (DB.plans.getAll, DB.subscriptions.*,
// DB.invoices.*) plus the raw query path for some operations. We expose
// all of them as jest.fn() so each test can shape return values directly.
const mockDbQuery = jest.fn();
const mockDbConnect = jest.fn(async () => ({
  query: mockDbQuery,
  release: jest.fn(),
}));
const mockPlans = {
  getAll: jest.fn(),
  getById: jest.fn(),
};
const mockSubscriptions = {
  getByCompanyId: jest.fn(),
  create: jest.fn(),
  cancel: jest.fn(),
};
const mockInvoices = {
  getByCompanyId: jest.fn(),
  getById: jest.fn(),
  create: jest.fn(),
  markPaid: jest.fn(),
};
jest.mock('../database/db', () => ({
  db: { query: mockDbQuery, connect: mockDbConnect },
  plans: mockPlans,
  subscriptions: mockSubscriptions,
  invoices: mockInvoices,
}));

// ---- Mock the session middleware so we can inject req.auth per test. ----
// The real middleware reads a cookie; in tests we set req.auth directly.
// requireSparksRole models the real hierarchy from sessionAuth.js so tests
// can detect a regression that lets a lower-ranked role through.
let mockTestAuth = null;
const SPARKS_RANK = { advisor: 1, collaborator: 1, support: 2, admin: 3 };
jest.mock('../server/middleware/sessionAuth', () => {
  return {
    requireAuth: (req, res, next) => {
      if (!mockTestAuth) return res.status(401).json({ error: 'Authentication required' });
      req.auth = mockTestAuth;
      next();
    },
    requireSparksRole: (required) => (req, res, next) => {
      if (!req.auth) return res.status(401).json({ error: 'Authentication required' });
      const userRank = SPARKS_RANK[req.auth.sparks_role] || 0;
      const requiredRank = SPARKS_RANK[required] || 0;
      if (userRank < requiredRank) {
        return res.status(403).json({ error: 'Forbidden — requires ' + required });
      }
      next();
    },
    setSessionCookie: jest.fn(),
    clearSessionCookie: jest.fn(),
    loadSession: (req, _res, next) => next(),
  };
});

const request = require('supertest');
const express = require('express');
const billingRouter = require('../server/routes/billing');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/billing', billingRouter);
  return app;
}

beforeEach(() => {
  mockDbQuery.mockReset();
  mockDbConnect.mockClear();
  Object.values(mockPlans).forEach(fn => fn.mockReset());
  Object.values(mockSubscriptions).forEach(fn => fn.mockReset());
  Object.values(mockInvoices).forEach(fn => fn.mockReset());
  mockTestAuth = null;
});

// ============================================================
// Auth boundary
// ============================================================
describe('Billing — auth boundary', () => {
  test('GET /plans rejects unauthenticated requests with 401', async () => {
    const res = await request(makeApp()).get('/api/billing/plans');
    expect(res.status).toBe(401);
  });

  test('GET /plans rejects authenticated NON-sparks user with 403', async () => {
    mockTestAuth = { person_id: 'person_alex', sparks_role: null, role_level: 1, company_id: 'company_x' };
    const res = await request(makeApp()).get('/api/billing/plans');
    expect(res.status).toBe(403);
  });

  test('POST /company/:id/subscribe rejects support-level user (admin-only endpoint)', async () => {
    // Mock models the real admin > support > advisor hierarchy. A support
    // user must be blocked from admin-only endpoints — anything OTHER than
    // 403 here would be a real regression in role gating.
    mockTestAuth = { person_id: 'person_op', sparks_role: 'support', role_level: 3 };
    const res = await request(makeApp())
      .post('/api/billing/company/company_x/subscribe')
      .send({ plan_id: 'plan_small' });
    expect(res.status).toBe(403);
  });

  test('POST /company/:id/subscribe allows admin user past role gate', async () => {
    mockTestAuth = { person_id: 'person_admin', sparks_role: 'admin', role_level: 5 };
    mockPlans.getById.mockResolvedValueOnce({ id: 'plan_small', name: 'Small' });
    mockSubscriptions.getByCompanyId.mockResolvedValueOnce(null);
    mockSubscriptions.create.mockResolvedValueOnce({ id: 'sub_new', company_id: 'company_x' });
    const res = await request(makeApp())
      .post('/api/billing/company/company_x/subscribe')
      .send({ plan_id: 'plan_small' });
    // Past the guard; downstream details are route-specific. The hard
    // assertion: NOT a 401 or 403 (auth + role gating passed).
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ============================================================
// GET /plans — list pricing plans
// ============================================================
describe('Billing — GET /plans', () => {
  beforeEach(() => {
    mockTestAuth = { person_id: 'person_admin', sparks_role: 'admin', role_level: 5 };
  });

  test('returns the rows that DB.plans.getAll produces', async () => {
    mockPlans.getAll.mockResolvedValueOnce([
      { id: 'plan_small', name: 'Small', monthly_price_cents: 9900 },
      { id: 'plan_large', name: 'Large', monthly_price_cents: 49900 },
    ]);
    const res = await request(makeApp()).get('/api/billing/plans');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].id).toBe('plan_small');
  });

  test('500s if the DB helper throws', async () => {
    mockPlans.getAll.mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(makeApp()).get('/api/billing/plans');
    expect(res.status).toBe(500);
  });
});

// ============================================================
// GET /company/:companyId — billing snapshot
// ============================================================
describe('Billing — GET /company/:id', () => {
  beforeEach(() => {
    mockTestAuth = { person_id: 'person_admin', sparks_role: 'admin', role_level: 5 };
  });

  test('returns subscription + invoices payload for an existing company', async () => {
    mockSubscriptions.getByCompanyId.mockResolvedValueOnce({
      id: 'sub_abc', company_id: 'company_x', plan_id: 'plan_small', status: 'active',
    });
    mockInvoices.getByCompanyId.mockResolvedValueOnce([
      { id: 'inv_1', amount_cents: 9900, status: 'paid' },
    ]);
    const res = await request(makeApp()).get('/api/billing/company/company_x');
    expect(res.status).toBe(200);
    expect(res.body.subscription.id).toBe('sub_abc');
    expect(res.body.invoices).toHaveLength(1);
  });

  test('returns null subscription cleanly when no record exists', async () => {
    mockSubscriptions.getByCompanyId.mockResolvedValueOnce(null);
    mockInvoices.getByCompanyId.mockResolvedValueOnce([]);
    const res = await request(makeApp()).get('/api/billing/company/company_unknown');
    expect(res.status).toBe(200);
    expect(res.body.subscription).toBeNull();
    expect(res.body.invoices).toEqual([]);
  });
});

// ============================================================
// POST /company/:companyId/invoice — manual invoice generation
// ============================================================
describe('Billing — POST /company/:id/invoice', () => {
  beforeEach(() => {
    mockTestAuth = { person_id: 'person_admin', sparks_role: 'admin', role_level: 5 };
  });

  test('rejects missing amount with 400', async () => {
    const res = await request(makeApp())
      .post('/api/billing/company/company_x/invoice')
      .send({}); // no amount_cents
    // Should validate input before hitting DB.
    expect([400, 422]).toContain(res.status);
  });

  test('rejects negative amount with 400', async () => {
    const res = await request(makeApp())
      .post('/api/billing/company/company_x/invoice')
      .send({ amount_cents: -100, description: 'refund test' });
    expect([400, 422]).toContain(res.status);
  });
});

// ============================================================
// Cross-cutting safety
// ============================================================
describe('Billing — safety regressions', () => {
  test('billing.js requires authentication for ALL routes', async () => {
    // Sanity scan: every route in billing.js should 401 when called
    // without auth. We just hit a few representative endpoints.
    const routes = [
      ['get',  '/api/billing/plans'],
      ['get',  '/api/billing/company/company_x'],
      ['post', '/api/billing/company/company_x/subscribe'],
      ['post', '/api/billing/company/company_x/cancel'],
      ['post', '/api/billing/company/company_x/invoice'],
      ['get',  '/api/billing/revenue'],
    ];
    const app = makeApp();
    for (const [method, route] of routes) {
      const res = await request(app)[method](route).send({});
      expect(res.status).toBe(401);
    }
  });

  test('amount fields are not interpreted as strings (no NaN coercion bugs)', async () => {
    mockTestAuth = { person_id: 'person_admin', sparks_role: 'admin', role_level: 5 };
    const res = await request(makeApp())
      .post('/api/billing/company/company_x/invoice')
      .send({ amount_cents: 'not a number', description: 'test' });
    // Must reject — silently coercing 'not a number' → NaN → DB insert would
    // either store NaN or fail at write time. Either 400 from validation or
    // 500 from DB error is acceptable; what's NOT acceptable is a 200.
    expect(res.status).not.toBe(200);
  });
});
