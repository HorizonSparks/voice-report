/**
 * CEO Control Center — pure authorization guards.
 *
 * The CEO (role_level >= 7) has ABSOLUTE power WITHIN their own company ONLY. These functions
 * never touch the database — they validate a CEO's intent so the route layer and the proof
 * harness share ONE source of truth for the wall. Everything here is deterministic and unit-tested
 * by database/ceo-control-center-proof.js.
 *
 * The walls (why each guard exists):
 *   - role_level >= 7                  → only a CEO can use the Control Center (NOT_CEO)
 *   - target.company_id == actor's     → a CEO can never reach into another company (CROSS_COMPANY)
 *   - no sparks_role grant             → a customer CEO can never mint Horizon Sparks (cross-tenant)
 *                                        staff — that is Sparks-only (NO_SPARKS_GRANT)
 *   - target is not Sparks staff       → a CEO cannot manage a Sparks account (TARGET_IS_SPARKS)
 *   - role_level clamped to [1,7]      → company roles cap at CEO; nothing above is grantable here
 *   - no self-lockout / self-deactivate→ a CEO cannot strip their own CEO role or disable themselves
 */

const { LEVEL } = require('../auth/roleLevels');

const CEO_LEVEL = LEVEL.CEO;
const MAX_COMPANY_ROLE = LEVEL.CEO; // company role ladder caps at CEO; sparks_role is the only tier above and is Sparks-only
const ALLOWED_STATUS = ['active', 'inactive', 'suspended'];

function isCeo(actor) {
  return !!actor && Number(actor.role_level || 0) >= CEO_LEVEL;
}

/** Error that carries an HTTP status + machine code so routes map it to a clean response. */
class CeoGuardError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'CeoGuardError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Validate + sanitize a CEO's change to a person. Returns a CLEAN updates object containing ONLY
 * the fields a CEO is permitted to set, with safe (clamped/whitelisted) values. Throws CeoGuardError
 * on any violation. The route passes the returned object straight to db.people.update (which
 * dual-writes role/status to the shared login identity — see database/db.js _mirrorIdentityToShared).
 *
 * @param {object} actor  - getActor(req): { person_id, role_level, company_id, sparks_role, ... }
 * @param {object} target - the person row being changed (from the company DB)
 * @param {object} body   - the request body (untrusted)
 */
function sanitizePersonChange(actor, target, body) {
  if (!isCeo(actor)) throw new CeoGuardError(403, 'CEO access required', 'NOT_CEO');
  if (!target) throw new CeoGuardError(404, 'Person not found', 'NO_TARGET');
  body = body || {};

  // Company wall — FAIL CLOSED (Codex review). req.db is already the company DB, but the shared-pool
  // fallback means we must still check company_id explicitly. A missing company on EITHER side is a
  // hard deny: an actor with no company has no tenant to be CEO of, and a target with no company is
  // an un-owned/mis-migrated row that must never be writable across the wall.
  const actorCompany = actor.company_id || null;
  if (!actorCompany) throw new CeoGuardError(403, 'No company context for this CEO', 'NO_COMPANY');
  if (!target.company_id || String(target.company_id) !== String(actorCompany)) {
    throw new CeoGuardError(403, 'That person is not in your company', 'CROSS_COMPANY');
  }

  // A CEO can NEVER grant Horizon Sparks (cross-tenant) staff status.
  if (body.sparks_role !== undefined && body.sparks_role !== null && body.sparks_role !== '') {
    throw new CeoGuardError(403, 'A company CEO cannot grant Horizon Sparks staff roles', 'NO_SPARKS_GRANT');
  }
  // A CEO cannot manage an account that IS Sparks staff (that account belongs to the Sparks window).
  if (target.sparks_role) {
    throw new CeoGuardError(403, 'That account is managed by Horizon Sparks', 'TARGET_IS_SPARKS');
  }

  const isSelf = String(target.id) === String(actor.person_id);
  const updates = {};

  // role_level — the "set permissions" power. Clamp to [1,7].
  if (body.role_level !== undefined) {
    let lvl = parseInt(body.role_level, 10);
    if (Number.isNaN(lvl)) throw new CeoGuardError(400, 'role_level must be a number', 'BAD_ROLE');
    if (lvl < 1) lvl = 1;
    if (lvl > MAX_COMPANY_ROLE) lvl = MAX_COMPANY_ROLE;
    if (isSelf && lvl < CEO_LEVEL) {
      throw new CeoGuardError(400, 'You cannot lower your own CEO role (self-lockout)', 'SELF_LOCKOUT');
    }
    updates.role_level = lvl;
  }

  // Plain profile / permission fields a CEO may set.
  if (body.role_title !== undefined) updates.role_title = String(body.role_title).slice(0, 120);
  if (body.trade !== undefined) updates.trade = body.trade || null;
  if (body.supervisor_id !== undefined) {
    // A person cannot be their own supervisor (would corrupt the see-down chain).
    if (body.supervisor_id && String(body.supervisor_id) === String(target.id)) {
      throw new CeoGuardError(400, 'A person cannot supervise themselves', 'SELF_SUPERVISE');
    }
    updates.supervisor_id = body.supervisor_id || null;
  }

  // status — activate / deactivate / suspend (a "restriction"). Whitelisted values only.
  if (body.status !== undefined) {
    const s = String(body.status);
    if (!ALLOWED_STATUS.includes(s)) throw new CeoGuardError(400, 'Invalid status', 'BAD_STATUS');
    if (isSelf && s !== 'active') {
      throw new CeoGuardError(400, 'You cannot deactivate your own account', 'SELF_DEACTIVATE');
    }
    updates.status = s;
  }

  if (Object.keys(updates).length === 0) {
    throw new CeoGuardError(400, 'No permitted fields to update', 'NOOP');
  }
  return updates;
}

module.exports = {
  CEO_LEVEL,
  MAX_COMPANY_ROLE,
  ALLOWED_STATUS,
  isCeo,
  CeoGuardError,
  sanitizePersonChange,
};
