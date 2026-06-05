/**
 * CEO Control Center — the per-company ADMINISTRATOR window's backend.
 *
 * The CEO (role_level >= 6) has absolute power WITHIN their own company only. This router is
 * DISTINCT from /api/sparks (the Horizon Sparks-staff Command Center). It rides on the proven
 * isolation: tenantFilter locks a non-Sparks user to their own company_id, and attachCompanyDb
 * points req.db at that company's physical DB (Level 1). Projects-within-a-company don't bleed
 * (Level 2). See database/{isolation,project-isolation}-proof.js.
 *
 * Endpoints (the genuinely NEW power; project/member CRUD already lives at /api/projects, role>=3):
 *   GET   /api/ceo/overview      — the walled portfolio glance (company + projects + people roster)
 *   PATCH /api/ceo/people/:id    — CEO sets a person's role / permissions / status (guarded)
 *
 * All admin actions write to the company's OWN DB; people role/status changes dual-write to the
 * shared login identity via db.people.update (so login stays consistent — PR #5).
 */
const { Router } = require('express');
const DB = require('../../database/db');
const { requireAuth } = require('../middleware/sessionAuth');
const { getActor } = require('../auth/authz');
const { isCeo, CeoGuardError, sanitizePersonChange } = require('../lib/ceoGuards');

const router = Router();

/**
 * Wall: every /api/ceo/* route requires an authenticated CUSTOMER CEO (role_level >= 6) operating
 * on their OWN company. Fails CLOSED (Codex review):
 *   - Sparks staff (any sparks_role) are DENIED — they use /api/sparks (the Sparks Command Center),
 *     never this customer window. This also closes the ?company_id impersonation path for /api/ceo.
 *   - A missing company context is DENIED — a CEO query must NEVER run without a company predicate.
 */
function requireCeo(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: 'Authentication required' });
  if (req.auth.sparks_role) {
    return res.status(403).json({ error: 'Horizon Sparks staff use the Sparks Command Center, not the CEO window' });
  }
  const actor = getActor(req);
  if (!isCeo(actor)) return res.status(403).json({ error: 'CEO access required' });
  // Fail CLOSED and SELF-CONTAINED (Codex round 3): the actor MUST have a company, and the route's
  // tenant binding MUST equal it. Don't merely trust req.companyId — prove it matches the authenticated
  // identity, so a CEO query can never read another tenant even if upstream tenant binding regresses.
  if (!actor.company_id || !req.companyId || String(req.companyId) !== String(actor.company_id)) {
    return res.status(403).json({ error: 'Company context required' });
  }
  req.ceoActor = actor;
  next();
}

/**
 * GET /api/ceo/overview — one call powers the Control Center landing:
 *   company metadata + every project in the company (with member counts) + the people roster.
 * Strictly scoped to req.companyId (the CEO's own company).
 */
router.get('/overview', requireAuth, requireCeo, async (req, res) => {
  try {
    const db = req.db || DB;
    const companyId = req.ceoActor.company_id; // the AUTHENTICATED actor's company (== req.companyId, asserted by requireCeo)

    // Always company-scoped (Codex: never drop the WHERE predicate).
    const projects = (await db.db.query(
      `SELECT p.*,
        (SELECT COUNT(*)::int FROM project_members pm WHERE pm.project_id = p.id) AS member_count
       FROM projects p WHERE p.company_id = $1 ORDER BY p.name`,
      [companyId]
    )).rows;

    const people = (await db.db.query(
      `SELECT id, name, role_title, role_level, trade, status, supervisor_id, photo, company_id
       FROM people WHERE company_id = $1 ORDER BY role_level DESC, name`,
      [companyId]
    )).rows;

    // Company metadata lives in the SHARED registry DB (source of truth), not the per-company DB.
    let company = { id: companyId };
    try {
      const row = (await DB.db.query(
        'SELECT id, name, slug, status, tier FROM companies WHERE id = $1', [companyId]
      )).rows[0];
      if (row) company = row;
    } catch (e) {
      // Isolation is enforced by the company predicates above, not this cosmetic lookup — but log it
      // so a registry/config inconsistency is visible during rollout instead of silently masked.
      console.error('[CEO-OVERVIEW] company registry lookup failed for', companyId, '-', e.message);
    }

    res.json({
      company,
      counts: {
        projects: projects.length,
        people: people.length,
        active_people: people.filter(p => p.status === 'active').length,
      },
      projects,
      people,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/ceo/people/:id — CEO sets a person's role / permissions / status within the company.
 * Guards (sanitizePersonChange): role-6 only, clamp role_level [1,6], no sparks_role grant,
 * no managing Sparks staff, no cross-company target, no self-lockout / self-deactivate.
 * The cleaned update goes through db.people.update, which dual-writes role/status to the shared
 * login identity (the identity watchdog catches any residual drift).
 */
router.patch('/people/:id', requireAuth, requireCeo, async (req, res) => {
  try {
    const db = req.db || DB;
    const companyId = req.ceoActor.company_id; // the AUTHENTICATED actor's company (asserted == req.companyId)
    // Fetch the target SCOPED to the CEO's company (Codex: id alone is not enough under shared-pool fallback).
    const target = (await db.db.query(
      'SELECT * FROM people WHERE id = $1 AND company_id = $2', [req.params.id, companyId])).rows[0];

    let updates;
    try {
      updates = sanitizePersonChange(req.ceoActor, target, req.body || {});
    } catch (e) {
      if (e instanceof CeoGuardError) return res.status(e.status).json({ error: e.message, code: e.code });
      throw e;
    }

    // If reassigning supervisor, the supervisor must be a real person in THIS company (scoped lookup).
    if (updates.supervisor_id) {
      const sup = (await db.db.query(
        'SELECT id FROM people WHERE id = $1 AND company_id = $2', [updates.supervisor_id, companyId])).rows[0];
      if (!sup) return res.status(400).json({ error: 'Supervisor not found in your company', code: 'NO_SUPERVISOR' });
    }

    const result = await db.people.update(req.params.id, updates);
    if (!result) return res.status(404).json({ error: 'Person not found' });

    res.json({ success: true, id: req.params.id, applied: updates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
// Exposed for the isolation proof (database/ceo-control-center-proof.js).
module.exports.requireCeo = requireCeo;
