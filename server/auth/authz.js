/**
 * Authorization Helpers
 * Centralized authorization logic — "derive actor, accept target"
 *
 * Role levels:
 *   1 = helper
 *   2 = journeyman
 *   3 = foreman
 *   4 = superintendent
 *   5 = admin
 *
 * is_admin is always an override.
 */
const DB = require('../../database/db');

/**
 * Extract actor identity from authenticated request.
 * Actor always comes from req.auth, never from client body/params.
 */
function getActor(req) {
  if (!req.auth) return null;
  return {
    person_id: req.auth.person_id,
    is_admin: req.auth.is_admin,
    role_level: req.auth.role_level,
    trade: req.auth.trade,
  };
}

/**
 * Can actor view target person's data?
 * Rules:
 *   - self: always
 *   - admin: always
 *   - chain-of-command: use existing DB visibility logic
 */
async function canViewPerson(actor, targetPersonId) {
  if (!actor) return false;
  if (actor.is_admin) return true;
  if (actor.person_id === targetPersonId) return true;

  // Use existing chain-of-command contact visibility
  try {
    return await DB.contacts.canMessage(actor.person_id, targetPersonId);
  } catch {
    return false;
  }
}

/**
 * Can actor manage (edit/delete) target person?
 * Rules:
 *   - admin: always
 *   - higher role_level in the target's chain: yes
 *   - self cannot manage self (for safety)
 */
async function canManagePerson(actor, targetPersonId) {
  if (!actor) return false;
  if (actor.is_admin) return true;

  try {
    const target = await DB.people.getById(targetPersonId);
    if (!target) return false;

    // Must be higher level
    if (actor.role_level <= (target.role_level || 1)) return false;

    // Must be in chain-of-command (supervisor or above)
    if (target.supervisor_id === actor.person_id) return true;

    // Check if actor is further up the chain
    let current = target;
    let depth = 0;
    while (current.supervisor_id && depth < 5) {
      if (current.supervisor_id === actor.person_id) return true;
      current = await DB.people.getById(current.supervisor_id);
      if (!current) break;
      depth++;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Can actor approve a JSA?
 * Rules:
 *   - admin: always
 *   - foreman approval: actor must be the JSA creator's supervisor or role_level >= 3
 *   - safety approval: actor must have safety authority (role_level >= 4 or is safety dept)
 */
async function canApproveJsa(actor, jsa) {
  if (!actor) return false;
  if (actor.is_admin) return true;

  const currentStatus = jsa.status || jsa.approval_status;

  // Foreman approval stage
  if (currentStatus === 'pending_foreman' || currentStatus === 'draft') {
    if (actor.role_level >= 3) return true;
    // Check if actor is the creator's supervisor
    if (jsa.created_by) {
      const creator = await DB.people.getById(jsa.created_by);
      if (creator && creator.supervisor_id === actor.person_id) return true;
    }
    return false;
  }

  // Safety approval stage
  if (currentStatus === 'pending_safety') {
    if (actor.role_level >= 4) return true;
    // Check if actor is in safety department
    if (actor.trade && actor.trade.toLowerCase().includes('safety')) return true;
    return false;
  }

  return actor.role_level >= 3;
}

/**
 * Can actor send message to target?
 * Uses existing DB.contacts.canMessage chain-of-command rules.
 * Admin always allowed.
 */
async function canMessage(actor, targetPersonId) {
  if (!actor) return false;
  if (actor.is_admin) return true;
  if (actor.person_id === targetPersonId) return false; // No self-messaging

  try {
    return await DB.contacts.canMessage(actor.person_id, targetPersonId);
  } catch {
    return false;
  }
}

module.exports = {
  getActor,
  canViewPerson,
  canManagePerson,
  canApproveJsa,
  canMessage,
};
