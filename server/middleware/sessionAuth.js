/**
 * Session Authentication Middleware
 * Loads session from hs_session cookie into req.auth
 *
 * req.auth shape:
 * {
 *   sessionId: string,
 *   person_id: string,
 *   is_admin: boolean,
 *   role_level: number,
 *   trade: string
 * }
 */
const DB = require('../../database/db');
const poolRouter = require('../../database/pool-router');
const DB_FULL = require('../../database/db');

const COOKIE_NAME = 'hs_session';

/**
 * Parse cookies from request header (no cookie-parser dependency needed)
 */
function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie;
  if (!header) return cookies;
  header.split(';').forEach(pair => {
    const [name, ...rest] = pair.trim().split('=');
    cookies[name] = decodeURIComponent(rest.join('='));
  });
  return cookies;
}

/**
 * Set the hs_session cookie on the response
 */
function setSessionCookie(res, sessionId, maxAge, req) {
  // Only set Secure flag when actually on HTTPS — HTTP cookies with Secure won't be sent back
  const isSecure = req ? (req.secure || req.headers['x-forwarded-proto'] === 'https') : false;
  const age = maxAge || 7 * 24 * 60 * 60; // 7 days
  res.setHeader('Set-Cookie', [
    // HttpOnly session token — not readable by JS
    [
      `${COOKIE_NAME}=${sessionId}`,
      'HttpOnly',
      isSecure ? 'Secure' : '',
      'SameSite=Lax',
      'Path=/',
      `Max-Age=${age}`,
    ].filter(Boolean).join('; '),
    // Companion presence flag — readable by JS so client can skip /api/me when no session exists
    [
      `${COOKIE_NAME}_present=1`,
      isSecure ? 'Secure' : '',
      'SameSite=Lax',
      'Path=/',
      `Max-Age=${age}`,
    ].filter(Boolean).join('; '),
  ]);
}

/**
 * Clear the hs_session cookie
 */
function clearSessionCookie(res, req) {
  const isSecure = req ? (req.secure || req.headers['x-forwarded-proto'] === 'https') : false;
  res.setHeader('Set-Cookie', [
    [
      `${COOKIE_NAME}=`,
      'HttpOnly',
      isSecure ? 'Secure' : '',
      'SameSite=Lax',
      'Path=/',
      'Max-Age=0',
    ].filter(Boolean).join('; '),
    [
      `${COOKIE_NAME}_present=`,
      isSecure ? 'Secure' : '',
      'SameSite=Lax',
      'Path=/',
      'Max-Age=0',
    ].filter(Boolean).join('; '),
  ]);
}

/**
 * Global auth loader — mount before protected routes.
 * Populates req.auth if valid session exists, otherwise req.auth = null.
 * Does NOT block unauthenticated requests (use guards for that).
 */
async function loadSession(req, res, next) {
  req.auth = null;

    // Integration key auth — for cross-origin calls from LoopFolders
    const integrationKey = req.headers['x-integration-key'];
    if (integrationKey && process.env.INTEGRATION_KEY && integrationKey === process.env.INTEGRATION_KEY) {
      req.auth = {
        sessionId: 'integration_' + Date.now(),
        person_id: 'integration',
        is_admin: true,
        role_level: 5,
        trade: null,
        company_id: null,
        sparks_role: 'admin',
        isIntegration: true,
      };
      return next();
    }

  try {
    // Integration key auth — for cross-origin calls from LoopFolders
    const integrationKey = req.headers['x-integration-key'];
    if (integrationKey && process.env.INTEGRATION_KEY && integrationKey === process.env.INTEGRATION_KEY) {
      req.auth = {
        sessionId: 'integration_' + Date.now(),
        person_id: 'integration',
        is_admin: true,
        role_level: 5,
        trade: null,
        company_id: null,
        sparks_role: 'admin',
        isIntegration: true,
      };
      return next();
    }

    const cookies = parseCookies(req);
    const sessionId = cookies[COOKIE_NAME];
    if (!sessionId) return next();

    const session = await DB.sessions.getById(sessionId);
    if (!session) {
      // Invalid or expired session — clear the cookie
      clearSessionCookie(res, req);
      return next();
    }

    // Populate req.auth
    req.auth = {
      sessionId: session.sessionId,
      person_id: session.person_id,
      is_admin: session.is_admin,
      role_level: session.role_level,
      trade: session.trade,
      company_id: session.company_id,
      sparks_role: session.sparks_role,
    };

    // Touch last_seen_at (non-blocking, don't await)
    DB.sessions.touch(session.sessionId).catch(() => {});
  } catch (err) {
    console.error('Session load error:', err.message);
    // Don't block the request on session errors
  }

  next();
}

// ============================================
// GUARD MIDDLEWARE
// ============================================

/**
 * 401 if not authenticated
 */
function requireAuth(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: 'Authentication required' });
  next();
}

/**
 * 403 unless admin
 */
function requireAdmin(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: 'Authentication required' });
  if (!req.auth.is_admin && req.auth.role_level < 5) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/**
 * 403 unless role_level >= minLevel (or admin)
 */
function requireRoleLevel(minLevel) {
  return (req, res, next) => {
    if (!req.auth) return res.status(401).json({ error: 'Authentication required' });
    if (!req.auth.is_admin && req.auth.role_level < minLevel) {
      return res.status(403).json({ error: `Role level ${minLevel} or higher required` });
    }
    next();
  };
}

/**
 * Allow self-access or elevated access.
 * paramName: the req.params key that contains the target person_id
 * minLevel: minimum role_level for non-self access
 */
function requireSelfOrRoleLevel(paramName, minLevel) {
  return (req, res, next) => {
    if (!req.auth) return res.status(401).json({ error: 'Authentication required' });
    const targetId = req.params[paramName] || req.body[paramName];
    // Self-access always allowed
    if (targetId === req.auth.person_id) return next();
    // Otherwise need elevated role or admin
    if (!req.auth.is_admin && req.auth.role_level < minLevel) {
      return res.status(403).json({ error: 'Not authorized to access this resource' });
    }
    next();
  };
}

// ============================================
// TENANT & SPARKS GUARDS
// ============================================

/**
 * Tenant filter — injects req.companyId for data isolation.
 * Sparks admin/support can optionally target a specific company via ?company_id query param.
 * Regular users are locked to their own company.
 */
function tenantFilter(req, res, next) {
  if (!req.auth) return next();

  const sparksRole = req.auth.sparks_role;

  if (sparksRole === 'admin' || sparksRole === 'support') {
    // Sparks admin/support: query param override, else own company
    req.companyId = req.query.company_id || req.auth.company_id || null;
  } else {
    // Everyone else is locked to their own company
    req.companyId = req.auth.company_id || null;
  }

  next();
}

/**
 * Require a specific Sparks role (or higher).
 * Role hierarchy: admin(4) > support(3) > collaborator(2) > advisor(1)
 */
function requireSparksRole(minRole) {
  const roleLevel = { admin: 4, support: 3, collaborator: 2, advisor: 1 };
  const minLevel = roleLevel[minRole] || 0;

  return (req, res, next) => {
    if (!req.auth) return res.status(401).json({ error: 'Authentication required' });

    const userRole = req.auth.sparks_role;
    if (!userRole) return res.status(403).json({ error: 'Sparks access required' });

    const userLevel = roleLevel[userRole] || 0;
    if (userLevel < minLevel) {
      return res.status(403).json({ error: `Sparks ${minRole} access required` });
    }

    next();
  };
}

/**
 * Enforce trade licensing — blocks access if the company doesn't have the trade licensed.
 * Sparks admin/support bypass this check.
 * Trade comes from req.query.trade, req.params.trade, or req.body.trade.
 */
async function enforceTradeLimit(req, res, next) {
  // Sparks admin/support bypass licensing
  const sparksRole = req.auth && req.auth.sparks_role;
  if (sparksRole === 'admin' || sparksRole === 'support') return next();

  // Get the trade being accessed
  const trade = req.query.trade || req.params.trade || req.body?.trade;
  if (!trade) return next(); // No trade specified, nothing to enforce

  // Get the user's company
  const companyId = req.auth?.company_id;
  if (!companyId) return next(); // No company, nothing to check

  try {
    const { rows } = await DB.db.query(
      "SELECT 1 FROM company_trades WHERE company_id = $1 AND trade = $2 AND status = 'active'",
      [companyId, trade]
    );
    if (rows.length === 0) {
      return res.status(403).json({ error: `Trade "${trade}" is not licensed for your company` });
    }
    next();
  } catch (err) {
    console.error('Trade enforcement error:', err);
    next(); // Don't block on DB errors, but log them
  }
}

/**
 * Attach company-specific database to request.
 * When USE_COMPANY_DBS=true and a company has a dedicated DB,
 * req.db points to that company's DB. Otherwise, req.db = shared DB.
 */
function attachCompanyDb(req, res, next) {
  if (process.env.USE_COMPANY_DBS === 'true' && req.companyId && poolRouter.hasCompanyDb(req.companyId)) {
    const companyPool = poolRouter.getCompanyPool(req.companyId);
    req.db = DB.withPool(companyPool);
  } else {
    req.db = DB; // Default shared pool
  }
  next();
}


// ============================================
// EDIT MODE — Sparks operator simulation safety
// ============================================
const EDIT_MODE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const editModeSessions = new Map(); // sessionId -> { companyId, enabledAt, lastActivityAt }

function isEditModeActive(sessionId) {
  const entry = editModeSessions.get(sessionId);
  if (!entry) return false;
  if (Date.now() - entry.lastActivityAt > EDIT_MODE_TIMEOUT_MS) {
    editModeSessions.delete(sessionId);
    return false;
  }
  return true;
}

function getEditModeRemaining(sessionId) {
  const entry = editModeSessions.get(sessionId);
  if (!entry) return 0;
  const remaining = EDIT_MODE_TIMEOUT_MS - (Date.now() - entry.lastActivityAt);
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

function enableEditMode(sessionId, companyId) {
  editModeSessions.set(sessionId, { companyId, enabledAt: Date.now(), lastActivityAt: Date.now() });
}

function disableEditMode(sessionId) {
  editModeSessions.delete(sessionId);
}

function touchEditMode(sessionId) {
  const entry = editModeSessions.get(sessionId);
  if (entry) entry.lastActivityAt = Date.now();
}

// Cleanup expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, entry] of editModeSessions) {
    if (now - entry.lastActivityAt > EDIT_MODE_TIMEOUT_MS) {
      editModeSessions.delete(sessionId);
    }
  }
}, 5 * 60 * 1000);

/**
 * Block write operations for Sparks operators in simulation mode unless edit mode is active.
 * Passes through immediately for non-Sparks users (customers are never affected).
 */
function requireSparksEditMode(req, res, next) {
  // Not a Sparks operator? Pass through — customers unaffected
  if (!req.auth?.sparks_role) return next();

  // Not in simulation (operating on own company)? Pass through
  if (!req.companyId || req.companyId === req.auth.company_id) return next();

  // Sparks operator in simulation — check edit mode AND company match
  const editEntry = editModeSessions.get(req.auth.sessionId);
  if (!editEntry || !isEditModeActive(req.auth.sessionId) || editEntry.companyId !== req.companyId) {
    return res.status(403).json({ error: 'Read-only mode. Enable editing first.', code: 'READONLY' });
  }

  // Touch the timer
  touchEditMode(req.auth.sessionId);

  // Audit log the write (non-blocking)
  try {
    const details = JSON.stringify({
      method: req.method,
      path: req.originalUrl,
      body_keys: req.body ? Object.keys(req.body).join(',') : '',
    });
    DB_FULL.db.query(
      "INSERT INTO sparks_audit_log (id, person_id, person_name, action, resource_type, resource_id, details, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())",
      ['audit_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
       req.auth.person_id, '', 'simulation_write',
       req.method + ' ' + req.baseUrl, req.params?.id || '', details]
    ).catch(() => {});
  } catch(e) {}

  next();
}

module.exports = {
  COOKIE_NAME,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  loadSession,
  requireAuth,
  requireAdmin,
  requireRoleLevel,
  requireSelfOrRoleLevel,
  tenantFilter,
  requireSparksRole,
  enforceTradeLimit,
  attachCompanyDb,
  requireSparksEditMode,
  isEditModeActive,
  getEditModeRemaining,
  enableEditMode,
  disableEditMode,
  touchEditMode,
};
