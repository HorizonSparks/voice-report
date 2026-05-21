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
const crypto = require('crypto');
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

// Columns the resolver returns. Kept in one constant so the SELECT and the
// post-INSERT SELECT below stay in lockstep — drift between them caused
// confusing "field missing" bugs the last time this was refactored.
const PEOPLE_COLUMNS = 'id, name, role_title, role_level, sparks_role, photo, status, ' +
                      'company_id, keycloak_user_id, keycloak_username';

// Extract company_id from a verified JWT. Tries multiple claim locations
// because Keycloak's mapping is configured server-side and we want the
// resolver to keep working regardless of which convention the realm admin
// uses. Returns null if no recognizable company claim is found.
function extractCompanyId(claims) {
  if (!claims || typeof claims !== 'object') return null;
  // 1. Direct custom attribute mapped as claim — recommended approach.
  if (typeof claims.company_id === 'string' && claims.company_id.trim()) {
    return claims.company_id.trim();
  }
  // 2. Namespaced claim (common when avoiding short-name collisions).
  const ns = claims['https://horizonsparks.ai/company_id'];
  if (typeof ns === 'string' && ns.trim()) return ns.trim();
  // 3. Hasura-style namespaced claim block (the JWT we already inspect for
  //    x-hasura-user-id could also carry an x-hasura-company-id).
  const h = claims['https://hasura.io/jwt/claims'];
  if (h && typeof h === 'object' && typeof h['x-hasura-company-id'] === 'string') {
    const v = h['x-hasura-company-id'].trim();
    if (v) return v;
  }
  // 4. Group-based: e.g. claims.groups = ['/companies/company_horizon_sparks'].
  if (Array.isArray(claims.groups)) {
    for (const g of claims.groups) {
      if (typeof g !== 'string') continue;
      const m = g.match(/(?:^|\/)companies\/([^/]+)/);
      if (m) return m[1];
    }
  }
  return null;
}

// Build a default display name from JWT claims. We try name, then given+family,
// then preferred_username, then sub. Always returns a non-empty string.
function deriveName(claims) {
  if (typeof claims.name === 'string' && claims.name.trim()) return claims.name.trim();
  const given = (claims.given_name || '').trim();
  const family = (claims.family_name || '').trim();
  if (given || family) return `${given} ${family}`.trim();
  if (claims.preferred_username) return String(claims.preferred_username);
  return String(claims.sub || 'Unknown User');
}

/**
 * Look up a voicereport.people row by Keycloak user_id, with fallbacks.
 *
 * Resolution order:
 *   1. Match by keycloak_user_id (sub) — fast path for already-provisioned users
 *   2. Match by keycloak_username (preferred_username) — legacy mappings; lazy-
 *      upgrades the row with the now-known sub
 *   3. If still unmapped AND the JWT carries a company_id claim, auto-create
 *      a new row from JWT claims. Returns the new row.
 *   4. If still unmapped AND no company_id claim, return null — the caller
 *      then 403s with "user not provisioned" (same as legacy behavior).
 */
async function resolvePersonFromClaims(claims) {
  const sub = claims.sub;
  const username = claims.preferred_username || null;

  if (sub) {
    const r = await DB.db.query(
      `SELECT ${PEOPLE_COLUMNS} FROM voicereport.people WHERE keycloak_user_id = $1 LIMIT 1`,
      [sub]
    );
    if (r.rows[0]) return r.rows[0];
  }

  if (username) {
    const r = await DB.db.query(
      `SELECT ${PEOPLE_COLUMNS} FROM voicereport.people WHERE keycloak_username = $1 LIMIT 1`,
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

  // Auto-provision path. Requires a derivable company_id — either from the
  // JWT, or from KEYCLOAK_AUTO_PROVISION_DEFAULT_COMPANY env as a fallback
  // for realms that haven't yet been configured with a company_id claim
  // mapping. Without a default and no claim, the new row would be useless
  // (most queries scope by company), so we return null instead.
  //
  // SECURITY MODEL: trust in the company_id claim depends on the Keycloak
  // realm configuration. The realm admin MUST map company_id from an
  // admin-controlled source (group membership or admin-managed user
  // attribute), NOT a self-service attribute. If users can set their own
  // company_id, this code would let any user join any tenant. We defense-
  // in-depth this by verifying the company exists, but the primary defense
  // is Keycloak-side. See docs/KEYCLOAK_COMPANY_CLAIM_SETUP.md.
  //
  // The env fallback is INTENTIONALLY a separate knob — when set, it means
  // "every authenticated Keycloak user with no explicit company assignment
  // lands in this default company". Set it to a sandbox/demo tenant, NOT
  // your main production tenant, unless you trust every Keycloak user.
  const claimedCompanyId = extractCompanyId(claims);
  const defaultCompanyId = process.env.KEYCLOAK_AUTO_PROVISION_DEFAULT_COMPANY || null;
  const company_id = claimedCompanyId || defaultCompanyId;
  if (!sub || !company_id) return null;

  // Reject phantom company_ids — the claim must reference a real tenant.
  // Defense-in-depth only; not a substitute for proper Keycloak attribute
  // mapping (see SECURITY MODEL above).
  try {
    const { rows: companyRows } = await DB.db.query(
      'SELECT id FROM voicereport.companies WHERE id = $1 LIMIT 1',
      [company_id]
    );
    if (companyRows.length === 0) {
      console.warn('[verifyKeycloakJwt] auto-provision rejected: unknown company_id', {
        sub, claimed_company_id: company_id,
      });
      return null;
    }
  } catch (err) {
    console.error('[verifyKeycloakJwt] company lookup failed during auto-provision', err);
    return null;
  }

  const newId = 'person_' + crypto.randomUUID().slice(0, 12);
  const newName = deriveName(claims);
  // Generate an unguessable PIN so legacy PIN-login fails for auto-provisioned
  // users — they must always authenticate via Keycloak. 32 hex chars exceeds
  // any practical PIN-entry surface area.
  const sentinelPin = crypto.randomBytes(16).toString('hex');

  try {
    const r = await DB.db.query(
      `INSERT INTO voicereport.people (id, name, pin, role_title, role_level, company_id,
                                       keycloak_user_id, keycloak_username, status,
                                       created_at, updated_at)
       VALUES ($1, $2, $3, 'User', 1, $4, $5, $6, 'active', NOW(), NOW())
       RETURNING ${PEOPLE_COLUMNS}`,
      [newId, newName, sentinelPin, company_id, sub, username]
    );
    console.log('[verifyKeycloakJwt] auto-provisioned new user', {
      id: r.rows[0].id, sub, username, company_id, name: newName,
    });
    return r.rows[0];
  } catch (err) {
    // Race recovery: a concurrent request just provisioned this sub. The
    // unique index uniq_people_keycloak_user_id (keycloak_auto_provision.sql)
    // produces 23505. Re-fetch and return the winner's row.
    const isExpectedRace = err && err.code === '23505'
      && (err.constraint === 'uniq_people_keycloak_user_id'
          || /keycloak_user_id/i.test(err.constraint || ''));
    if (isExpectedRace) {
      const r2 = await DB.db.query(
        `SELECT ${PEOPLE_COLUMNS} FROM voicereport.people WHERE keycloak_user_id = $1 LIMIT 1`,
        [sub]
      );
      if (r2.rows[0]) return r2.rows[0];
      // Index winner not findable — should not happen. Log loudly.
      console.error('[verifyKeycloakJwt] race winner not findable after 23505', { sub });
      return null;
    }
    if (err && err.code === '23505') {
      // A DIFFERENT unique constraint fired — programming or schema bug,
      // not a race. Log a distinct message so it doesn't look like a normal
      // unmapped-user 403 to whoever reads the logs later.
      console.error('[verifyKeycloakJwt] unexpected unique violation during auto-provision', {
        sub, constraint: err.constraint, detail: err.detail,
      });
      return null;
    }
    console.error('[verifyKeycloakJwt] auto-provision failed', { sub, err: err && err.message });
    return null;
  }
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
