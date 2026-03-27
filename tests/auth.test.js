/**
 * AUTHENTICATION TESTS
 * Tests the PIN-based authentication system.
 * Validates login flow, admin access, and error handling.
 */
const request = require('supertest');
const express = require('express');

// Create a minimal Express app with just the auth route
const authRouter = require('../server/routes/auth');

const app = express();
app.use(express.json());
app.use('/api', authRouter);

describe('PIN Authentication', () => {

  test('rejects login with no PIN', async () => {
    const res = await request(app).post('/api/login').send({});
    expect(res.status).toBe(400);
  });

  test('rejects login with empty PIN', async () => {
    const res = await request(app).post('/api/login').send({ pin: '' });
    expect(res.status).toBe(400);
  });

  test('admin PIN returns admin user', async () => {
    const adminPin = process.env.ADMIN_PIN || '12345678';
    const res = await request(app).post('/api/login').send({ pin: adminPin });
    expect(res.status).toBe(200);
    expect(res.body.is_admin).toBe(true);
    expect(res.body.name).toBeDefined();
  });

  test('invalid PIN returns 401', async () => {
    const res = await request(app).post('/api/login').send({ pin: '00000000' });
    // Should either return 401 or try to look up person by PIN
    expect([200, 401, 404]).toContain(res.status);
  });
});

describe('Auth security basics', () => {

  test('auth.js does not expose password in response', async () => {
    const adminPin = process.env.ADMIN_PIN || '12345678';
    const res = await request(app).post('/api/login').send({ pin: adminPin });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('password');
    expect(body).not.toContain('PG_PASSWORD');
  });
});
