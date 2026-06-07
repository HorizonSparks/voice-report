'use strict';

/**
 * Keycloak SSO routes for Voice Report.
 *
 * Provides the "one shared login" UX:
 * - GET /auth/sso/login   → redirect to Keycloak authorize endpoint (PKCE)
 * - GET /auth/sso/callback → exchange code for tokens, resolve person, set hs_session cookie, redirect home
 * - GET /auth/sso/logout   → clear hs_session, redirect to Keycloak end_session_endpoint
 *
 * After callback succeeds we create a normal hs_session row and set the
 * existing hs_session cookie. Downstream code (sessionAuth.loadSession) is
 * unchanged — it just sees a normal session as if the user logged in by PIN.
 *
 * Required env (all optional — routes return 503 if any missing, so PIN flow
 * keeps working until full SSO config lands):
 *   KEYCLOAK_ISSUER             https://keycloak.horizonsparks.ai/realms/app
 *   KEYCLOAK_OIDC_CLIENT_ID     app   (same client PIDS-app already uses)
 *   KEYCLOAK_OIDC_CLIENT_SECRET <secret from Keycloak admin>
 *   PUBLIC_BASE_URL             https://app.horizonsparks.ai (or whatever VR is served at)
 */

const express = require('express');
const crypto = require('crypto');
const { resolvePersonFromClaims } = require('../middleware/verifyKeycloakJwt');
const DB = require('../../database/db');

const router = express.Router();

const ISSUER = process.env.KEYCLOAK_ISSUER;
const CLIENT_ID = process.env.KEYCLOAK_OIDC_CLIENT_ID;
const CLIENT_SECRET = process.env.KEYCLOAK_OIDC_CLIENT_SECRET;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || '';

function authzEndpoint() { return ISSUER && ISSUER.replace(/\/$/, '') + '/protocol/openid-connect/auth'; }
function tokenEndpoint() { return ISSUER && ISSUER.replace(/\/$/, '') + '/protocol/openid-connect/token'; }
function endSessionEndpoint() { return ISSUER && ISSUER.replace(/\/$/, '') + '/protocol/openid-connect/logout'; }
function callbackUrl(req) {
  const base = PUBLIC_BASE_URL || (req.protocol + '://' + req.get('host'));
  return base.replace(/\/$/, '') + '/auth/sso/callback';
}

function ssoConfigured() {
  return Boolean(ISSUER && CLIENT_ID && CLIENT_SECRET);
}

// In-memory PKCE state cache. Short-lived (5 min). For multi-instance deploys
// move this to the sessions table — fine for single-container Voice Report today.
const pkceStore = new Map(); // state -> { verifier, returnTo, expires }
const PKCE_TTL_MS = 5 * 60 * 1000;
function rememberPkce(state, verifier, returnTo) {
  pkceStore.set(state, { verifier, returnTo, expires: Date.now() + PKCE_TTL_MS });
  // Opportunistic cleanup
  for (const [k, v] of pkceStore.entries()) if (v.expires < Date.now()) pkceStore.delete(k);
}
function consumePkce(state) {
  const v = pkceStore.get(state);
  if (!v) return null;
  pkceStore.delete(state);
  if (v.expires < Date.now()) return null;
  return v;
}

function pkceChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// GET /auth/sso/login?return_to=/some/path
router.get('/login', (req, res) => {
  if (!ssoConfigured()) {
    return res.status(503).json({
      error: 'SSO not configured',
      missing: ['KEYCLOAK_ISSUER', 'KEYCLOAK_OIDC_CLIENT_ID', 'KEYCLOAK_OIDC_CLIENT_SECRET'].filter(
        (k) => !process.env[k]
      ),
    });
  }
  const verifier = crypto.randomBytes(32).toString('base64url');
  const state = crypto.randomBytes(16).toString('base64url');
  const returnTo = (typeof req.query.return_to === 'string' && req.query.return_to.startsWith('/')) ? req.query.return_to : '/';
  rememberPkce(state, verifier, returnTo);

  const url = new URL(authzEndpoint());
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', callbackUrl(req));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', pkceChallenge(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  res.redirect(url.toString());
});

// GET /auth/sso/callback?code=...&state=...
router.get('/callback', async (req, res) => {
  if (!ssoConfigured()) return res.status(503).json({ error: 'SSO not configured' });

  const { code, state, error: oidcError, error_description } = req.query;
  if (oidcError) return res.status(400).json({ error: 'oidc_error', detail: { oidcError, error_description } });
  if (!code || !state) return res.status(400).json({ error: 'missing_code_or_state' });

  const pkce = consumePkce(String(state));
  if (!pkce) return res.status(400).json({ error: 'invalid_or_expired_state' });

  // Exchange code for tokens
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(code),
    redirect_uri: callbackUrl(req),
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code_verifier: pkce.verifier,
  });

  let tokens;
  try {
    const r = await fetch(tokenEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!r.ok) {
      const text = await r.text();
      console.error('[sso/callback] token exchange failed', r.status, text);
      return res.status(502).json({ error: 'token_exchange_failed', status: r.status });
    }
    tokens = await r.json();
  } catch (err) {
    console.error('[sso/callback] token exchange threw', err.message);
    return res.status(502).json({ error: 'token_exchange_threw', detail: err.message });
  }

  // Decode id_token claims (signature was verified by Keycloak; we just read claims)
  let claims;
  try {
    const seg = tokens.id_token.split('.')[1];
    claims = JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'));
  } catch (err) {
    return res.status(502).json({ error: 'malformed_id_token' });
  }

  const person = await resolvePersonFromClaims(claims);
  if (!person) {
    return res.status(403).json({
      error: 'authenticated_but_unmapped',
      message: 'Your Keycloak account exists but is not yet mapped to a Voice Report user. Ask Ellery to provision you.',
      keycloak_user_id: claims.sub,
      keycloak_username: claims.preferred_username,
    });
  }

  // Create a normal hs_session row so existing sessionAuth flow handles the rest.
  // sessions.create matches the existing PIN-flow shape — it generates the UUID itself.
  let sessionRow;
  try {
    sessionRow = await DB.sessions.create({
      person_id: person.id,
      is_admin: person.role_level >= 6 || person.sparks_role === 'admin',
      role_level: person.role_level,
      trade: person.trade || null,
      company_id: person.company_id,
      sparks_role: person.sparks_role,
      user_agent: req.get('user-agent') || null,
      ip_address: req.ip || req.connection?.remoteAddress || null,
    });
  } catch (err) {
    console.error('[sso/callback] session create failed', err.message);
    return res.status(500).json({ error: 'session_create_failed' });
  }
  const sessionId = sessionRow.id;
  const maxAgeSeconds = 7 * 24 * 60 * 60; // matches existing 7-day session expiry

  // Set hs_session cookie. Cookie domain is configurable so it can span both
  // both apps share .horizonsparks.ai once VR moves off voice-report.ai (retired) onto a horizonsparks.ai subdomain.
  const cookieDomain = process.env.COOKIE_DOMAIN || undefined;
  const cookieParts = [
    'hs_session=' + sessionId,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Max-Age=' + maxAgeSeconds,
  ];
  if (cookieDomain) cookieParts.push('Domain=' + cookieDomain);
  res.setHeader('Set-Cookie', cookieParts.join('; '));

  res.redirect(pkce.returnTo || '/');
});

// GET /auth/sso/logout — clear local session + redirect to Keycloak logout
router.get('/logout', async (req, res) => {
  // Clear our cookie
  const cookieDomain = process.env.COOKIE_DOMAIN || undefined;
  const clearParts = ['hs_session=', 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=0'];
  if (cookieDomain) clearParts.push('Domain=' + cookieDomain);
  res.setHeader('Set-Cookie', clearParts.join('; '));

  if (!ssoConfigured()) return res.redirect('/');

  // Best-effort delete of hs_session row
  if (req.auth && req.auth.sessionId) {
    DB.sessions.delete(req.auth.sessionId).catch(() => {});
  }

  const url = new URL(endSessionEndpoint());
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('post_logout_redirect_uri', PUBLIC_BASE_URL || (req.protocol + '://' + req.get('host')));
  res.redirect(url.toString());
});

module.exports = router;
