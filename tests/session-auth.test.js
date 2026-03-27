/**
 * SESSION AUTH TESTS
 * Tests the cookie-backed session system, middleware, and auth guards.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

describe('Session middleware exists and exports correctly', () => {
  let sessionAuth;

  beforeAll(() => {
    sessionAuth = require('../server/middleware/sessionAuth');
  });

  test('exports loadSession function', () => {
    expect(typeof sessionAuth.loadSession).toBe('function');
  });

  test('exports requireAuth guard', () => {
    expect(typeof sessionAuth.requireAuth).toBe('function');
  });

  test('exports requireAdmin guard', () => {
    expect(typeof sessionAuth.requireAdmin).toBe('function');
  });

  test('exports requireRoleLevel factory', () => {
    expect(typeof sessionAuth.requireRoleLevel).toBe('function');
    // Should return a middleware function
    const middleware = sessionAuth.requireRoleLevel(3);
    expect(typeof middleware).toBe('function');
  });

  test('exports requireSelfOrRoleLevel factory', () => {
    expect(typeof sessionAuth.requireSelfOrRoleLevel).toBe('function');
    const middleware = sessionAuth.requireSelfOrRoleLevel('person_id', 3);
    expect(typeof middleware).toBe('function');
  });

  test('exports cookie helpers', () => {
    expect(typeof sessionAuth.setSessionCookie).toBe('function');
    expect(typeof sessionAuth.clearSessionCookie).toBe('function');
    expect(typeof sessionAuth.parseCookies).toBe('function');
  });

  test('COOKIE_NAME is hs_session', () => {
    expect(sessionAuth.COOKIE_NAME).toBe('hs_session');
  });
});

describe('Authorization helpers exist and export correctly', () => {
  let authz;

  beforeAll(() => {
    authz = require('../server/auth/authz');
  });

  test('exports getActor function', () => {
    expect(typeof authz.getActor).toBe('function');
  });

  test('exports canViewPerson function', () => {
    expect(typeof authz.canViewPerson).toBe('function');
  });

  test('exports canManagePerson function', () => {
    expect(typeof authz.canManagePerson).toBe('function');
  });

  test('exports canApproveJsa function', () => {
    expect(typeof authz.canApproveJsa).toBe('function');
  });

  test('exports canMessage function', () => {
    expect(typeof authz.canMessage).toBe('function');
  });
});

describe('Auth guard behavior (unit tests)', () => {
  const { requireAuth, requireAdmin, requireRoleLevel, requireSelfOrRoleLevel } = require('../server/middleware/sessionAuth');

  function mockRes() {
    const res = {
      statusCode: null,
      body: null,
      status(code) { res.statusCode = code; return res; },
      json(body) { res.body = body; return res; },
    };
    return res;
  }

  test('requireAuth returns 401 when req.auth is null', () => {
    const req = { auth: null };
    const res = mockRes();
    const next = jest.fn();
    requireAuth(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('requireAuth calls next when req.auth exists', () => {
    const req = { auth: { person_id: '123', is_admin: false, role_level: 2 } };
    const res = mockRes();
    const next = jest.fn();
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('requireAdmin returns 403 for non-admin', () => {
    const req = { auth: { person_id: '123', is_admin: false, role_level: 2 } };
    const res = mockRes();
    const next = jest.fn();
    requireAdmin(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('requireAdmin allows admin', () => {
    const req = { auth: { person_id: '123', is_admin: true, role_level: 5 } };
    const res = mockRes();
    const next = jest.fn();
    requireAdmin(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('requireRoleLevel(3) blocks role_level 2', () => {
    const req = { auth: { person_id: '123', is_admin: false, role_level: 2 } };
    const res = mockRes();
    const next = jest.fn();
    requireRoleLevel(3)(req, res, next);
    expect(res.statusCode).toBe(403);
  });

  test('requireRoleLevel(3) allows role_level 3', () => {
    const req = { auth: { person_id: '123', is_admin: false, role_level: 3 } };
    const res = mockRes();
    const next = jest.fn();
    requireRoleLevel(3)(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('requireRoleLevel(3) allows admin regardless of level', () => {
    const req = { auth: { person_id: '123', is_admin: true, role_level: 1 } };
    const res = mockRes();
    const next = jest.fn();
    requireRoleLevel(3)(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('requireSelfOrRoleLevel allows self-access', () => {
    const req = { auth: { person_id: '123', is_admin: false, role_level: 1 }, params: { person_id: '123' }, body: {} };
    const res = mockRes();
    const next = jest.fn();
    requireSelfOrRoleLevel('person_id', 3)(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('requireSelfOrRoleLevel blocks non-self low-level', () => {
    const req = { auth: { person_id: '123', is_admin: false, role_level: 2 }, params: { person_id: '456' }, body: {} };
    const res = mockRes();
    const next = jest.fn();
    requireSelfOrRoleLevel('person_id', 3)(req, res, next);
    expect(res.statusCode).toBe(403);
  });

  test('requireSelfOrRoleLevel allows non-self supervisor', () => {
    const req = { auth: { person_id: '123', is_admin: false, role_level: 3 }, params: { person_id: '456' }, body: {} };
    const res = mockRes();
    const next = jest.fn();
    requireSelfOrRoleLevel('person_id', 3)(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe('getActor behavior', () => {
  const { getActor } = require('../server/auth/authz');

  test('returns null when req.auth is null', () => {
    expect(getActor({ auth: null })).toBeNull();
  });

  test('returns actor object from req.auth', () => {
    const req = { auth: { person_id: '123', is_admin: false, role_level: 3, trade: 'Electrical' } };
    const actor = getActor(req);
    expect(actor.person_id).toBe('123');
    expect(actor.is_admin).toBe(false);
    expect(actor.role_level).toBe(3);
    expect(actor.trade).toBe('Electrical');
  });
});

describe('Cookie parsing', () => {
  const { parseCookies } = require('../server/middleware/sessionAuth');

  test('parses hs_session cookie', () => {
    const req = { headers: { cookie: 'hs_session=abc123; other=xyz' } };
    const cookies = parseCookies(req);
    expect(cookies.hs_session).toBe('abc123');
    expect(cookies.other).toBe('xyz');
  });

  test('handles missing cookie header', () => {
    const req = { headers: {} };
    const cookies = parseCookies(req);
    expect(Object.keys(cookies)).toHaveLength(0);
  });
});

describe('WebAuthn uses @simplewebauthn/server', () => {
  const content = fs.readFileSync(path.join(ROOT, 'server/routes/webauthn.js'), 'utf8');

  test('imports @simplewebauthn/server functions', () => {
    expect(content).toContain("require('@simplewebauthn/server')");
    expect(content).toContain('generateRegistrationOptions');
    expect(content).toContain('verifyRegistrationResponse');
    expect(content).toContain('generateAuthenticationOptions');
    expect(content).toContain('verifyAuthenticationResponse');
  });

  test('registration requires auth', () => {
    expect(content).toContain('requireAuth');
  });

  test('creates session on login', () => {
    expect(content).toContain('DB.sessions.create');
    expect(content).toContain('setSessionCookie');
  });

  test('does NOT use file-based challenges', () => {
    expect(content).not.toContain('fs.writeFileSync');
    expect(content).not.toContain('.challenges');
  });

  test('uses in-memory challenge store', () => {
    expect(content).toContain('challengeStore');
    expect(content).toContain('storeChallenge');
    expect(content).toContain('getAndDeleteChallenge');
  });

  test('updates credential counter for replay protection', () => {
    expect(content).toContain('updateCounter');
  });
});

describe('Routes use auth middleware', () => {

  test('messages.js imports requireAuth', () => {
    const content = fs.readFileSync(path.join(ROOT, 'server/routes/messages.js'), 'utf8');
    expect(content).toContain("require('../middleware/sessionAuth')");
    expect(content).toContain('requireAuth');
    // Should NOT trust from_id from client in POST
    expect(content).toContain('actor.person_id');
  });

  test('reports.js imports requireAuth', () => {
    const content = fs.readFileSync(path.join(ROOT, 'server/routes/reports.js'), 'utf8');
    expect(content).toContain("require('../middleware/sessionAuth')");
    expect(content).toContain('requireAuth');
  });

  test('settings.js uses requireAdmin for write operations', () => {
    const content = fs.readFileSync(path.join(ROOT, 'server/routes/settings.js'), 'utf8');
    expect(content).toContain('requireAdmin');
  });

  test('people.js uses requireRoleLevel for create/delete', () => {
    const content = fs.readFileSync(path.join(ROOT, 'server/routes/people.js'), 'utf8');
    expect(content).toContain('requireRoleLevel');
    expect(content).toContain('requireSelfOrRoleLevel');
  });

  test('tasks.js derives person_id from session', () => {
    const content = fs.readFileSync(path.join(ROOT, 'server/routes/tasks.js'), 'utf8');
    expect(content).toContain('actor.person_id');
    expect(content).not.toContain('req.body.person_id || task.assigned_to');
  });

  test('punchList.js requires auth', () => {
    const content = fs.readFileSync(path.join(ROOT, 'server/routes/punchList.js'), 'utf8');
    expect(content).toContain('requireAuth');
  });

  test('dailyPlans.js requires auth', () => {
    const content = fs.readFileSync(path.join(ROOT, 'server/routes/dailyPlans.js'), 'utf8');
    expect(content).toContain('requireAuth');
  });

  test('jsa.js requires auth and derives approver from session', () => {
    const content = fs.readFileSync(path.join(ROOT, 'server/routes/jsa.js'), 'utf8');
    expect(content).toContain('requireAuth');
    expect(content).toContain('requireRoleLevel');
    expect(content).toContain('actor.person_id');
  });
});

describe('DB sessions module exists', () => {
  test('DB exports sessions namespace', () => {
    const DB = require('../database/db');
    expect(DB.sessions).toBeDefined();
    expect(typeof DB.sessions.create).toBe('function');
    expect(typeof DB.sessions.getById).toBe('function');
    expect(typeof DB.sessions.touch).toBe('function');
    expect(typeof DB.sessions.delete).toBe('function');
    expect(typeof DB.sessions.deleteExpired).toBe('function');
  });

  test('DB exports webauthnCredentials namespace', () => {
    const DB = require('../database/db');
    expect(DB.webauthnCredentials).toBeDefined();
    expect(typeof DB.webauthnCredentials.create).toBe('function');
    expect(typeof DB.webauthnCredentials.getByCredentialId).toBe('function');
    expect(typeof DB.webauthnCredentials.getForPerson).toBe('function');
    expect(typeof DB.webauthnCredentials.updateCounter).toBe('function');
  });
});

describe('Auth route has session + logout', () => {
  const content = fs.readFileSync(path.join(ROOT, 'server/routes/auth.js'), 'utf8');

  test('login creates session', () => {
    expect(content).toContain('DB.sessions.create');
    expect(content).toContain('setSessionCookie');
  });

  test('logout endpoint exists', () => {
    expect(content).toContain("post('/logout'");
    expect(content).toContain('DB.sessions.delete');
    expect(content).toContain('clearSessionCookie');
  });

  test('me endpoint exists', () => {
    expect(content).toContain("get('/me'");
  });
});

describe('Session middleware is mounted globally', () => {
  const indexContent = fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf8');

  test('loadSession is imported and used', () => {
    expect(indexContent).toContain('loadSession');
    expect(indexContent).toContain('app.use(loadSession)');
  });
});
