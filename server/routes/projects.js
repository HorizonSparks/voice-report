const { Router } = require('express');
const DB = require('../../database/db');
const {requireAuth, requireRoleLevel, requireSparksEditMode} = require('../middleware/sessionAuth');
const { getActor } = require('../auth/authz');

const router = Router();

// GET /api/projects — list projects (filtered by what you can see)
router.get('/', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    let rows;
    if (actor.is_admin || actor.role_level >= 3) {
      // PM/admin sees all projects in their company
      const trade = req.query.trade;
      if (req.companyId) {
        if (trade) {
          rows = (await (req.db || DB).db.query('SELECT * FROM projects WHERE company_id = $1 AND (trade = $2 OR trade IS NULL) ORDER BY name', [req.companyId, trade])).rows;
        } else {
          rows = (await (req.db || DB).db.query('SELECT * FROM projects WHERE company_id = $1 ORDER BY name', [req.companyId])).rows;
        }
      } else {
        if (trade) {
          rows = (await (req.db || DB).db.query('SELECT * FROM projects WHERE trade = $1 OR trade IS NULL ORDER BY name', [trade])).rows;
        } else {
          rows = (await (req.db || DB).db.query('SELECT * FROM projects ORDER BY name')).rows;
        }
      }
    } else {
      // Regular user sees only projects they're a member of (already company-scoped via membership)
      rows = (await (req.db || DB).db.query(
        `SELECT p.* FROM projects p
         JOIN project_members pm ON pm.project_id = p.id
         WHERE pm.person_id = $1
         ORDER BY p.name`,
        [actor.person_id]
      )).rows;
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/projects/:id — single project with members
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    const project = (await (req.db || DB).db.query('SELECT * FROM projects WHERE id = $1', [req.params.id])).rows[0];
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Authorization: same company, project member, or admin
    const sameCompany = req.companyId && project.company_id === req.companyId;
    const isMember = (await (req.db || DB).db.query('SELECT 1 FROM project_members WHERE project_id = $1 AND person_id = $2', [req.params.id, actor.person_id])).rows.length > 0;
    if (!actor.is_admin && !sameCompany && !isMember) {
      return res.status(403).json({ error: 'Not authorized to view this project' });
    }

    const members = (await (req.db || DB).db.query(
      `SELECT pm.*, p.name, p.role_title, p.photo, p.trade
       FROM project_members pm
       JOIN people p ON p.id = pm.person_id
       WHERE pm.project_id = $1
       ORDER BY pm.role DESC, p.name`,
      [req.params.id]
    )).rows;

    res.json({ ...project, members });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/projects — create project (PM/admin only)
router.post('/', requireAuth, requireSparksEditMode, requireRoleLevel(3), async (req, res) => {
  try {
    const { name, trade, description, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });

    const id = 'proj_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now();
    const actor = getActor(req);

    await (req.db || DB).db.query(
      'INSERT INTO projects (id, name, trade, owner_id, description, color, company_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, name, trade || null, actor.person_id, description || '', color || '#F99440', req.companyId || null]
    );

    // Auto-add creator as PM member
    await (req.db || DB).db.query(
      'INSERT INTO project_members (project_id, person_id, role) VALUES ($1, $2, $3)',
      [id, actor.person_id, 'pm']
    );

    const project = (await (req.db || DB).db.query('SELECT * FROM projects WHERE id = $1', [id])).rows[0];
    res.json(project);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/projects/:id — update project
router.put('/:id', requireAuth, requireSparksEditMode, requireRoleLevel(3), async (req, res) => {
  try {
    const actor = getActor(req);
    const project = (await (req.db || DB).db.query('SELECT * FROM projects WHERE id = $1', [req.params.id])).rows[0];
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Authorization: same company or admin
    const sameCompany = req.companyId && project.company_id === req.companyId;
    if (!actor.is_admin && !sameCompany) {
      return res.status(403).json({ error: 'Not authorized to modify this project' });
    }

    const { name, description, color, status } = req.body;
    await (req.db || DB).db.query(
      `UPDATE projects SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        color = COALESCE($3, color),
        status = COALESCE($4, status),
        updated_at = NOW()
       WHERE id = $5`,
      [name, description, color, status, req.params.id]
    );
    const updated = (await (req.db || DB).db.query('SELECT * FROM projects WHERE id = $1', [req.params.id])).rows[0];
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/projects/:id
router.delete('/:id', requireAuth, requireSparksEditMode, requireRoleLevel(3), async (req, res) => {
  try {
    const actor = getActor(req);
    const project = (await (req.db || DB).db.query('SELECT * FROM projects WHERE id = $1', [req.params.id])).rows[0];
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Authorization: same company or admin
    const sameCompany = req.companyId && project.company_id === req.companyId;
    if (!actor.is_admin && !sameCompany) {
      return res.status(403).json({ error: 'Not authorized to delete this project' });
    }

    await (req.db || DB).db.query('DELETE FROM project_members WHERE project_id = $1', [req.params.id]);
    await (req.db || DB).db.query('DELETE FROM projects WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/projects/:id/members — add member to project
router.post('/:id/members', requireAuth, requireSparksEditMode, requireRoleLevel(3), async (req, res) => {
  try {
    const actor = getActor(req);
    const project = (await (req.db || DB).db.query('SELECT * FROM projects WHERE id = $1', [req.params.id])).rows[0];
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const sameCompany = req.companyId && project.company_id === req.companyId;
    if (!actor.is_admin && !sameCompany) {
      return res.status(403).json({ error: 'Not authorized to modify this project' });
    }

    const { person_id, role } = req.body;
    if (!person_id) return res.status(400).json({ error: 'person_id required' });
    // Verify person exists in the same company DB
    const personExists = (await (req.db || DB).db.query("SELECT id FROM people WHERE id = $1", [person_id])).rows[0];
    if (!personExists) return res.status(400).json({ error: "Person not found in this company" });

    await (req.db || DB).db.query(
      'INSERT INTO project_members (project_id, person_id, role) VALUES ($1, $2, $3) ON CONFLICT (project_id, person_id) DO UPDATE SET role = $3',
      [req.params.id, person_id, role || 'member']
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/projects/:id/members/:person_id — remove member
router.delete('/:id/members/:person_id', requireAuth, requireSparksEditMode, requireRoleLevel(3), async (req, res) => {
  try {
    const actor = getActor(req);
    const project = (await (req.db || DB).db.query('SELECT * FROM projects WHERE id = $1', [req.params.id])).rows[0];
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const sameCompany = req.companyId && project.company_id === req.companyId;
    if (!actor.is_admin && !sameCompany) {
      return res.status(403).json({ error: 'Not authorized to modify this project' });
    }

    await (req.db || DB).db.query(
      'DELETE FROM project_members WHERE project_id = $1 AND person_id = $2',
      [req.params.id, req.params.person_id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
