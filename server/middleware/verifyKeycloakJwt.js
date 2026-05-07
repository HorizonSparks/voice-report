'use strict';

/**
 * Keycloak JWT verification — additive auth middleware.
 *
 * Behavior:
 * - If `Authorization: Bearer <jwt>` header is PRESENT and verifies against
 *   our Keycloak realm's JWKS, we resolve the user via voicereport.people.keycloak_user_id
 *   and populate req.auth with JWT-derived identity. JWT identity WINS over any
 *   caller-supplied `as_person_id`.
 * - If header is ABSENT, this middleware is a no-op — the existing
 *   sessionAuth.js loadAuth() flow runs unchanged (cookie + integration key).
 * - If header is PRESENT but verification fails, we log + clear req.auth so
 *   downstream requireAuth returns 401 (don't silently fall through to a weaker auth).
 *
 * Mount this BEFORE loadAuth() so JWT path takes priority on cross-app calls.
 *
 * Required env:
 *   KEYCLOAK_ISSUER  e.g. https://keycloak.horizonsparks.ai/realms/app
 *   KEYCLOAK_AUDIENCE  e.g. app   (the client_id; tokens issued to this client)
 *
 * Optional env:
 *   KEYCLOAK_JWKS_URL  derived from issuer if not set
 */

const { createRemoteJWKSet, jwtVerify } = require('jose');
const DB = require('../../database/db');

const ISSUER = process.env.KEYCLOAK_ISSUER;
const AUDIENCE = process.env.KEYCLOAK_AUDIENCE;
const JWKS_URL = process.env.KEYCLOAK_JWKS_URL ||
  (ISSUER ? ISSUER.replace(/\/$/, '') + '/protocol/openid-connect/certs' : null);

let JWKS = null;
function getJWKS() {
  if (!JWKS_URL) return null;
  if (!JWKS) JWKS = createRemoteJWKSet(new URL(JWKS_URL));
  return JWKS;
}

/**
 * Look up a voicereport.people row by Keycloak user_id, with fallback to
 * preferred_username. Returns the row or null.
 */
async function resolvePersonFromClaims(claims) {
  const sub = claims.sub;
  const username = claims.preferred_username || null;

  // Primary lookup: keycloak_user_id
  if (sub) {
    const r = await DB.db.query(
      'SELECT id, name, role_title, role_level, sparks_role, photo, status, ' +
      '       company_id, keycloak_user_id, keycloak_username ' +
      'FROM voicereport.people ' +
      'WHERE keycloak_user_id = $1 LIMIT 1',
      [sub]
    );
    if (r.rows[0]) return r.rows[0];
  }

  // Fallback lookup: keycloak_username (for users mapped before we had the UUID)
  if (username) {
    const r = await DB.db.query(
      'SELECT id, name, role_title, role_level, sparks_role, photo, status, ' +
      '       company_id, keycloak_user_id, keycloak_username ' +
      'FROM voicereport.people ' +
      'WHERE keycloak_username = $1 LIMIT 1',
      [username]
    );
    if (r.rows[0]) {
      // Lazy upgrade: backfill keycloak_user_id if it was missing
      if (!r.rows[0].keycloak_user_id && sub) {
        await DB.db.query(
          'UPDATE voicereport.people SET keycloak_user_id = $1 WHERE id = $2 AND keycloak_user_id IS NULL',
          [sub, r.rows[0].id]
        );
      }
      return r.rows[0];
    }
  }

  return null;
}

/**
 * Express middleware. Mount BEFORE loadAuth so JWT path runs first on cross-app calls.
 */
function verifyKeycloakJwt() {
  return async function (req, res, next) {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      // No Bearer token — let existing auth flow handle this request.
      return next();
    }

    if (!ISSUER || !AUDIENCE) {
      // Bearer token sent but server isn't configured for JWT verification.
      // Log loudly, refuse the request — caller is asking for stricter auth than
      // we can provide, so we MUST NOT silently fall back to integration key.
      console.error('[verifyKeycloakJwt] Bearer token received but KEYCLOAK_ISSUER/KEYCLOAK_AUDIENCE not configured');
      return res.status(503).json({ error: 'JWT verification not configured on this server' });
    }

    const token = authHeader.slice(7).trim();
    const jwks = getJWKS();

    try {
      // 2026-05-07: Removed the `audience` option from jwtVerify and instead
      // verify the authorized-party (azp) claim manually below. Why: Keycloak
      // by default issues access tokens with `aud: "account"` (the realm-level
      // account service), regardless of which client requested them. So the
      // strict `audience: "app"` check was failing every token with
      // ERR_JWT_CLAIM_VALIDATION_FAILED. The canonical resource-server check
      // for Keycloak when no Audience Mapper is configured is to look at
      // `azp` (authorized party) — that's set to the client_id that the
      // token was issued for. If the realm later adds an Audience Mapper
      // putting "app" into the `aud` array, the fallback below picks that up
      // too without needing another code change.
      const { payload } = await jwtVerify(token, jwks, {
        issuer: ISSUER,
        // audience intentionally omitted — verified manually below.
      });

      // Verify the token was issued for our client. Either the authorized
      // party (azp) matches, OR the audience array contains our client_id
      // (which only happens if the realm has an Audience Mapper).
      if (AUDIENCE) {
        const audValues = Array.isArray(payload.aud)
          ? payload.aud
          : payload.aud
            ? [payload.aud]
            : [];
        const azpMatch = payload.azp === AUDIENCE;
        const audMatch = audValues.includes(AUDIENCE);
        if (!azpMatch && !audMatch) {
          console.warn('[verifyKeycloakJwt] Token azp/aud mismatch', {
            expected: AUDIENCE,
            actual_azp: payload.azp,
            actual_aud: audValues,
          });
          return res.status(401).json({ error: 'Invalid or expired token' });
        }
      }

      const person = await resolvePersonFromClaims(payload);

      if (!person) {
        // JWT is valid but the user isn't mapped in our people table yet.
        // Don't silently fall through to integration-key path — that would
        // hide the mapping gap. Return a clear error so we know to map them.
        console.warn('[verifyKeycloakJwt] valid JWT for unmapped user', {
          sub: payload.sub,
          preferred_username: payload.preferred_username,
        });
        return res.status(403).json({
          error: 'User authenticated but not yet provisioned in Voice Report',
          keycloak_user_id: payload.sub,
          keycloak_username: payload.preferred_username,
        });
      }

      // JWT-derived identity wins. Populate req.auth in the same shape as
      // existing sessionAuth.js so downstream code is unchanged.
      req.auth = {
        person_id: person.id,
        name: person.name,
        role_level: person.role_level,
        sparks_role: person.sparks_role,
        company_id: person.company_id,
        is_admin: person.role_level >= 5 || person.sparks_role === 'admin',
        keycloak_user_id: person.keycloak_user_id,
        keycloak_username: person.keycloak_username,
        source: 'keycloak_jwt',
      };

      return next();
    } catch (err) {
      // Bearer token was sent but invalid (signature, expiry, audience, etc.).
      // Reject — do NOT fall through to a weaker auth path.
      console.warn('[verifyKeycloakJwt] JWT verification failed:', err.code || err.message);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

module.exports = { verifyKeycloakJwt, resolvePersonFromClaims };
