const { Router } = require('express');
const DB = require('../../database/db');
const { checkAndAlertJsaMismatch } = require('../lib/notifications');
const { requireAuth } = require('../middleware/sessionAuth');
const { getActor } = require('../auth/authz');

const router = Router();

// Shared JSA status enrichment for tasks
async function enrichWithJsaStatus(tasks, date) {
  try {
    const jsas = (await DB.db.query("SELECT id, person_id, crew_members, form_data, jsa_number FROM jsa_records WHERE date = $1 AND status != 'rejected'", [date])).rows;
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
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const plan = await DB.dailyPlans.getByDate(date, req.params.person_id);
    if (!plan) return res.json({ plan: null, tasks: [] });
    const tasks = await DB.dailyPlans.getTasks(plan.id);
    const enriched = [];
    for (const t of tasks) {
      const person = t.assigned_to ? (await DB.db.query('SELECT name, role_title FROM people WHERE id = $1', [t.assigned_to])).rows[0] : null;
      enriched.push({ ...t, assigned_to_name: person ? person.name : null, assigned_to_role: person ? person.role_title : null });
    }
    res.json({ plan, tasks: await enrichWithJsaStatus(enriched, date) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/my-tasks/:person_id', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    // Derive person_id from session for own tasks
    const targetId = actor.is_admin ? req.params.person_id : actor.person_id;
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const tasks = await DB.dailyPlans.getTasksForPerson(targetId, date);
    const enriched = [];
    for (const t of tasks) {
      const supervisor = (await DB.db.query('SELECT name FROM people WHERE id = $1', [t.created_by])).rows[0];
      enriched.push({ ...t, created_by_name: supervisor ? supervisor.name : null });
    }
    res.json(await enrichWithJsaStatus(enriched, date));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:person_id/tasks', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    const date = req.body.date || new Date().toISOString().split('T')[0];
    // Use actor as the plan creator
    const creatorId = actor.is_admin ? req.params.person_id : actor.person_id;
    const plan = await DB.dailyPlans.getOrCreate(date, creatorId, req.body.trade);
    const task = await DB.dailyPlans.addTask({ ...req.body, plan_id: plan.id });

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

router.put('/tasks/:task_id', requireAuth, async (req, res) => {
  try { res.json(await DB.dailyPlans.updateTask(req.params.task_id, req.body)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/tasks/:task_id', requireAuth, async (req, res) => {
  try { res.json(await DB.dailyPlans.deleteTask(req.params.task_id)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
