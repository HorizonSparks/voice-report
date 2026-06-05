const { Router } = require('express');
const DB = require('../../database/db');
const { requireAuth, requireSparksEditMode } = require('../middleware/sessionAuth');
const { getActor } = require('../auth/authz');

const router = Router();

// P2.1: rescue the Safety Observation Card off the legacy disk-JSON path (/api/forms)
// into the real, queryable, tenant-scoped safety_observations table.

// Idempotent column ensure (company_id + form_data), run against the SAME db handle the
// request uses (so per-company pools are migrated too, not just the shared pool). Cached
// per scope; only marked ready after a successful ALTER so a transient error retries.
const ensuredScopes = new Set();
async function ensureSchema(dbHandle, scopeKey) {
  if (ensuredScopes.has(scopeKey)) return;
  await dbHandle.safetyObservations.ensureSchema();
  ensuredScopes.add(scopeKey);
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// Build a single searchable description from the rich observation card so the data is
// findable even though the raw card is also preserved verbatim in form_data.
function composeDescription(fd = {}) {
  const parts = [];
  const add = (label, v) => {
    if (v !== undefined && v !== null && String(v).trim() !== '') parts.push(`${label}: ${v}`);
  };
  add('Category', fd.category);
  add('Observation type', fd.observation_type);
  add('Location', fd.location);
  add('Safe behaviors', fd.safe_behaviors);
  add('At-risk behaviors', fd.at_risk_behaviors);
  add('Corrective action', fd.corrective_action);
  add('Persons observed (craft)', fd.persons_observed_craft);
  add('Follow-up required', fd.follow_up_required);
  add('Supervisor notified', fd.supervisor_notified);
  add('Additional notes', fd.additional_notes);
  return parts.join('\n');
}

// POST /api/safety-observations — create. Identity + tenant come from the SESSION, never
// from the client body.
router.post('/', requireAuth, requireSparksEditMode, async (req, res) => {
  try {
    const actor = getActor(req);
    // Fail closed: a non-admin session must carry a company context.
    if (!actor.is_admin && !req.companyId) {
      return res.status(403).json({ error: 'No company context' });
    }
    const dbh = req.db || DB;
    await ensureSchema(dbh, req.companyId || 'shared');
    const fd = (req.body && req.body.form_data) || {};
    const result = await dbh.safetyObservations.create({
      person_id: actor.person_id,
      person_name: req.body.person_name || '',
      company_id: req.companyId || null,
      type: fd.observation_type || 'observation',
      severity: (fd.severity || 'low'),
      location: fd.location || null,
      description: composeDescription(fd),
      form_data: JSON.stringify(fd),
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/safety-observations — list, scoped to the actor's company + see-down chain
// (admins bypass the chain). Mirrors the reports list visibility model.
router.get('/', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    // Fail closed: a non-admin with no company context sees nothing.
    if (!actor.is_admin && !req.companyId) return res.json([]);
    const dbh = req.db || DB;
    await ensureSchema(dbh, req.companyId || 'shared');
    const filters = {};
    if (req.query.status) filters.status = req.query.status;
    if (req.query.type) filters.type = req.query.type;
    if (req.companyId) filters.company_id = req.companyId;
    if (!actor.is_admin) filters.viewer_id = actor.person_id;
    const rows = await dbh.safetyObservations.getAll(filters);
    res.json(rows.map((r) => ({ ...r, form_data: r.form_data ? safeParse(r.form_data) : null })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
