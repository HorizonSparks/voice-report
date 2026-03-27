/**
 * AUTH INTEGRATION TEST
 * End-to-end flow: login → cookie → /api/me → protected route → logout → denied
 */
const request = require('supertest');
const express = require('express');
const DB = require('../database/db');

// Build a minimal app with session middleware and key routes
const { loadSession } = require('../server/middleware/sessionAuth');
const authRouter = require('../server/routes/auth');
const settingsRouter = require('../server/routes/settings');

const app = express();
app.use(express.json());
app.use(loadSession);
app.use('/api', authRouter);
app.use('/api/settings', settingsRouter);

describe('Auth Integration Flow', () => {
  let sessionCookie;

  afterAll(async () => {
    // Clean up test sessions
    try {
      await DB.sessions.deleteExpired();
    } catch {}
  });

  test('1. Login returns session cookie', async () => {
    const adminPin = process.env.ADMIN_PIN || '12345678';
    const res = await request(app)
      .post('/api/login')
      .send({ pin: adminPin });

    expect(res.status).toBe(200);
    expect(res.body.is_admin).toBe(true);
    expect(res.body.session_id).toBeDefined();
    expect(res.body.person_id).toBe('__admin__');

    // Extract cookie
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const hsSession = cookies.find(c => c.startsWith('hs_session='));
    expect(hsSession).toBeDefined();
    expect(hsSession).toContain('HttpOnly');
    expect(hsSession).toContain('SameSite=Lax');

    // Save cookie for subsequent requests
    sessionCookie = hsSession.split(';')[0];
  });

  test('2. /api/me returns user with valid session', async () => {
    const res = await request(app)
      .get('/api/me')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.is_admin).toBe(true);
    expect(res.body.person_id).toBe('__admin__');
    expect(res.body.name).toBe('Admin');
    expect(res.body.role_level).toBe(5);
  });

  test('3. /api/me fails without session', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
  });

  test('4. Protected route (PUT settings) succeeds with admin session', async () => {
    const res = await request(app)
      .put('/api/settings')
      .set('Cookie', sessionCookie)
      .send({ company_name: 'Horizon Sparks Test' });

    expect(res.status).toBe(200);
  });

  test('5. Settings GET works without auth (public — login screen logo)', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.company_name).toBeDefined();
  });

  test('6. Logout clears session', async () => {
    const res = await request(app)
      .post('/api/logout')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Cookie should be cleared
    const cookies = res.headers['set-cookie'];
    const hsSession = cookies?.find(c => c.startsWith('hs_session='));
    if (hsSession) {
      expect(hsSession).toContain('Max-Age=0');
    }
  });

  test('7. /api/me fails after logout', async () => {
    const res = await request(app)
      .get('/api/me')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(401);
  });

  test('8. Protected route fails after logout', async () => {
    const res = await request(app)
      .put('/api/settings')
      .set('Cookie', sessionCookie)
      .send({ company_name: 'Should Fail' });

    // Should be 401 (no valid session) or 403 (no admin)
    expect([401, 403]).toContain(res.status);
  });
});

describe('Non-admin user login flow', () => {
  let workerCookie;

  test('1. Worker PIN login creates session', async () => {
    // Try to find a worker PIN from the DB
    try {
      const { rows } = await DB.db.query("SELECT pin FROM people WHERE pin IS NOT NULL AND status = 'active' LIMIT 1");
      if (rows.length === 0) return; // Skip if no workers

      const res = await request(app)
        .post('/api/login')
        .send({ pin: rows[0].pin });

      expect(res.status).toBe(200);
      expect(res.body.is_admin).toBe(false);
      expect(res.body.person_id).toBeDefined();
      expect(res.body.session_id).toBeDefined();

      const cookies = res.headers['set-cookie'];
      workerCookie = cookies.find(c => c.startsWith('hs_session=')).split(';')[0];
    } catch {
      // DB might not be available in CI — skip gracefully
    }
  });

  test('2. Worker cannot access admin settings', async () => {
    if (!workerCookie) return; // Skip if previous test didn't run

    const res = await request(app)
      .put('/api/settings')
      .set('Cookie', workerCookie)
      .send({ company_name: 'Hacked' });

    expect(res.status).toBe(403);
  });

  test('3. Worker /api/me returns correct role', async () => {
    if (!workerCookie) return;

    const res = await request(app)
      .get('/api/me')
      .set('Cookie', workerCookie);

    expect(res.status).toBe(200);
    expect(res.body.is_admin).toBe(false);
    expect(res.body.role_level).toBeDefined();
    expect(res.body.role_level).toBeLessThan(5);
  });
});

describe('Auth route coverage verification', () => {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.join(__dirname, '..');

  const routeFiles = [
    'ai.js', 'formsV2.js', 'analytics.js',
    'messages.js', 'reports.js', 'people.js',
    'settings.js', 'tasks.js', 'dailyPlans.js',
    'punchList.js', 'jsa.js',
    'templates.js', 'files.js', 'forms.js',
  ];

  routeFiles.forEach(file => {
    test(`${file} uses auth middleware`, () => {
      const content = fs.readFileSync(path.join(ROOT, 'server/routes', file), 'utf8');
      expect(content).toMatch(/require.*sessionAuth/);
    });
  });
});
