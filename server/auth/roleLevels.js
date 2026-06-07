/**
 * Canonical Horizon Sparks role ladder — THE ONE SOURCE OF TRUTH.
 *
 * The NUMBER is the law (it drives every wall/threshold). The NAME shown to a
 * person is just a label and may vary per trade/company (e.g. a level-4 may read
 * "General Foreman" or "Senior Instrument Tech"). Mirrors the 7 Keycloak realm
 * roles created 2026-06-06 in realm `app`.
 *
 *   7  ceo              CEO / owner
 *   6  pm               PM / Admin   (company-admin tier)
 *   5  superintendent   Superintendent
 *   4  general_foreman  General Foreman   (NEW rung — inserted 2026-06-06)
 *   3  foreman          Foreman
 *   2  journeyman       Journeyman
 *   1  helper           Helper
 *
 * REPORTING RULE: you report to the next-HIGHEST role PRESENT above you (skip
 * empty rungs). A rung exists in the ladder even when no one fills it on a project.
 *
 * ⚠️ MIGRATION IN PROGRESS (step 3 of the unification): the OLD Voice Report ladder
 * was 6 rungs (…4 superintendent, 5 admin, 6 CEO) and the codebase is INCONSISTENT
 * about level 4 (server header said superintendent; client TeamAssignment.jsx said
 * General Foreman). Do NOT renumber live data until inspect_role_levels.js has shown
 * what each stored level actually means. This module defines the TARGET; the data
 * migration + threshold cutover land together, Codex-reviewed, tested on one account.
 */

const LEVEL = Object.freeze({
  HELPER: 1,
  JOURNEYMAN: 2,
  FOREMAN: 3,
  GENERAL_FOREMAN: 4,
  SUPERINTENDENT: 5,
  PM: 6,
  CEO: 7,
});

// Keycloak realm-role NAME → canonical level. Names are unambiguous (unlike the
// legacy stored NUMBERS), so this map is safe for Keycloak logins.
// Aliases marked (provisional) are confirmed during the LoopFolders user migration.
const KEYCLOAK_ROLE_TO_LEVEL = Object.freeze({
  // canonical ladder (the 7 realm roles)
  ceo: 7, pm: 6, superintendent: 5, general_foreman: 4,
  foreman: 3, journeyman: 2, helper: 1,
  // backward-compat aliases for older tokens (provisional — confirm in migration)
  pm_admin: 6,          // old company-admin tier (was level 5) → PM (6)
  admin: 6,             // LoopFolders company admin → PM (6)
  pm_editor: 3, pm_viewer: 3, editor: 3, supervisor: 3, creator: 3,
  viewer: 1, user: 1,
});

// Default English label per level. UI may localize or apply a per-trade override.
const LEVEL_LABEL = Object.freeze({
  1: 'Helper',
  2: 'Journeyman',
  3: 'Foreman',
  4: 'General Foreman',
  5: 'Superintendent',
  6: 'PM / Admin',
  7: 'CEO',
});

// Named predicates — call these instead of bare numbers so intent is explicit
// and a future renumber only touches THIS file.
const isCeo            = (lvl) => Number(lvl || 0) >= LEVEL.CEO;             // 7
const isCompanyAdmin   = (lvl) => Number(lvl || 0) >= LEVEL.PM;             // 6 (old "admin" tier)
const canApproveSafety = (lvl) => Number(lvl || 0) >= LEVEL.SUPERINTENDENT; // 5 (old >=4)
const isForemanOrAbove = (lvl) => Number(lvl || 0) >= LEVEL.FOREMAN;        // 3
const isSupervisor     = (lvl) => Number(lvl || 0) >= LEVEL.JOURNEYMAN;     // 2

// Resolve the highest canonical level from a list of Keycloak app roles.
function deriveRoleLevel(appRoles) {
  let max = LEVEL.HELPER;
  for (const r of (appRoles || [])) {
    const lvl = KEYCLOAK_ROLE_TO_LEVEL[r];
    if (typeof lvl === 'number' && lvl > max) max = lvl;
  }
  return max;
}

module.exports = {
  LEVEL,
  KEYCLOAK_ROLE_TO_LEVEL,
  LEVEL_LABEL,
  isCeo,
  isCompanyAdmin,
  canApproveSafety,
  isForemanOrAbove,
  isSupervisor,
  deriveRoleLevel,
};
