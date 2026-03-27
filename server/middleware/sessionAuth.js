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
  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=${sessionId}`,
    'HttpOnly',
    isSecure ? 'Secure' : '',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAge || 7 * 24 * 60 * 60}`, // 7 days
  ].filter(Boolean).join('; '));
}

/**
 * Clear the hs_session cookie
 */
function clearSessionCookie(res, req) {
  const isSecure = req ? (req.secure || req.headers['x-forwarded-proto'] === 'https') : false;
  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=`,
    'HttpOnly',
    isSecure ? 'Secure' : '',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=0',
  ].filter(Boolean).join('; '));
}

/**
 * Global auth loader — mount before protected routes.
 * Populates req.auth if valid session exists, otherwise req.auth = null.
 * Does NOT block unauthenticated requests (use guards for that).
 */
async function loadSession(req, res, next) {
  req.auth = null;

  try {
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
};
