const { Router } = require('express');
const DB = require('../../database/db');
const { checkAndAlertJsaMismatch } = require('../lib/notifications');
const {requireAuth, requireSparksEditMode} = require('../middleware/sessionAuth');
const { getActor } = require('../auth/authz');

const router = Router();

// Shared JSA status enrichment for tasks
async function enrichWithJsaStatus(tasks, date, companyId, db) {
  try {
    let jsaQuery = "SELECT id, person_id, crew_members, form_data, jsa_number FROM jsa_records WHERE date = $1 AND status != 'rejected'";
    const jsaParams = [date];
    if (companyId) { jsaParams.push(companyId); jsaQuery += ` AND company_id = $${jsaParams.length}`; }
    const jsas = (await (db || DB).db.query(jsaQuery, jsaParams)).rows;
    return tasks.map(task => {
      if (!task.assigned_to) return { ...task, jsa_status: 'unknown' };
      const personJsas = jsas.filter(j => {
        if (j.person_id === task.assigned_to) return true;
        try { return JSON.parse(j.crew_members || '[]').some(c => c.id === task.assigned_to || c.person_id === task.assigned_to); } catch { return false; }
      });
      if (personJsas.length === 0) return { ...task, jsa_status: 'no_jsa' };
      const taskWords = ((task.title || '') + ' ' + (task.description || '')).toLowerCase().split(/\s+/).filter(w => w.length > 3);
      if (taskWords.length === 0) return { ...task, jsa_status: 'has_jsa', jsa_number: personJsas[0].jsa_number };
      for (const jsa of personJsas) {
        let fd; try { fd = JSON.parse(jsa.form_data || '{}'); } catch { fd = {}; }
        const jsaWords = ((fd.task_description || '') + ' ' + (fd.work_area || '')).toLowerCase().split(/\s+/).filter(w => w.length > 3);
        if (taskWords.filter(w => jsaWords.includes(w)).length / taskWords.length >= 0.3) return { ...task, jsa_status: 'match', jsa_number: jsa.jsa_number };
      }
      return { ...task, jsa_status: 'mismatch', jsa_number: personJsas[0].jsa_number };
    });
  } catch { return tasks; }
}

router.get('/:person_id', requireAuth, async (req, res) => {
  try {
    // Company isolation — verify target person exists and is in the same company
    if (req.companyId) {
      const target = await (req.db || DB).people.getById(req.params.person_id);
      if (!target || target.company_id !== req.companyId) return res.status(404).json({ error: 'Not found' });
    }
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const plan = await (req.db || DB).dailyPlans.getByDate(date, req.params.person_id);
    if (!plan) return res.json({ plan: null, tasks: [] });
    const tasks = await (req.db || DB).dailyPlans.getTasks(plan.id);
    const enriched = [];
    for (const t of tasks) {
      const person = t.assigned_to ? (await (req.db || DB).db.query('SELECT name, role_title FROM people WHERE id = $1', [t.assigned_to])).rows[0] : null;
      enriched.push({ ...t, assigned_to_name: person ? person.name : null, assigned_to_role: person ? person.role_title : null });
    }
    res.json({ plan, tasks: await enrichWithJsaStatus(enriched, date, req.companyId, req.db) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/my-tasks/:person_id', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    // Derive person_id from session for own tasks
    const targetId = actor.is_admin ? req.params.person_id : actor.person_id;
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const tasks = await (req.db || DB).dailyPlans.getTasksForPerson(targetId, date);
    const enriched = [];
    for (const t of tasks) {
      const supervisor = (await (req.db || DB).db.query('SELECT name FROM people WHERE id = $1', [t.created_by])).rows[0];
      enriched.push({ ...t, created_by_name: supervisor ? supervisor.name : null });
    }
    res.json(await enrichWithJsaStatus(enriched, date, req.companyId, req.db));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:person_id/tasks', requireAuth, requireSparksEditMode, async (req, res) => {
  try {
    const actor = getActor(req);
    const date = req.body.date || new Date().toISOString().split('T')[0];
    // Use actor as the plan creator
    const creatorId = actor.is_admin ? req.params.person_id : actor.person_id;
    const plan = await (req.db || DB).dailyPlans.getOrCreate(date, creatorId, req.body.trade);
    const task = await (req.db || DB).dailyPlans.addTask({ ...req.body, plan_id: plan.id });

    // Check JSA status for assigned person(s) and send alerts if needed
    const assignedTo = req.body.assigned_to;
    if (assignedTo) {
      const persons = Array.isArray(assignedTo) ? assignedTo : [assignedTo];
      persons.forEach(pid => {
        if (pid) checkAndAlertJsaMismatch(pid, { id: task.id, title: req.body.title, description: req.body.description }, creatorId);
      });
    }

    res.json(task);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/tasks/:task_id', requireAuth, requireSparksEditMode, async (req, res) => {
  try {
    const task = await (req.db || DB).db.query('SELECT t.assigned_to, dp.created_by FROM daily_plan_tasks t JOIN daily_plans dp ON dp.id = t.plan_id WHERE t.id = $1', [req.params.task_id]);
    if (!task.rows[0]) return res.status(404).json({ error: 'Task not found' });
    const t = task.rows[0];
    const isOwner = t.assigned_to === req.auth.person_id || t.created_by === req.auth.person_id;
    if (!isOwner && (req.auth.role_level || 0) < 3) return res.status(403).json({ error: 'Not authorized' });
    res.json(await (req.db || DB).dailyPlans.updateTask(req.params.task_id, req.body));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/tasks/:task_id', requireAuth, requireSparksEditMode, async (req, res) => {
  try {
    const task = await (req.db || DB).db.query('SELECT t.assigned_to, dp.created_by FROM daily_plan_tasks t JOIN daily_plans dp ON dp.id = t.plan_id WHERE t.id = $1', [req.params.task_id]);
    if (!task.rows[0]) return res.status(404).json({ error: 'Task not found' });
    const t = task.rows[0];
    const isOwner = t.assigned_to === req.auth.person_id || t.created_by === req.auth.person_id;
    if (!isOwner && (req.auth.role_level || 0) < 3) return res.status(403).json({ error: 'Not authorized' });
    res.json(await (req.db || DB).dailyPlans.deleteTask(req.params.task_id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
