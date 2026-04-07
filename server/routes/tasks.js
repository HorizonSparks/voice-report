const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const DB = require('../../database/db');
const {requireAuth, requireSelfOrRoleLevel, requireSparksEditMode} = require('../middleware/sessionAuth');
const { getActor } = require('../auth/authz');

/**
 * Verify the caller is authorized to access the given task.
 * Allowed when:
 *   - caller owns the task (created_by or assigned_to)
 *   - caller is admin
 *   - caller has role_level >= 3 (foreman+)
 *   - at minimum, task belongs to the same company
 * Returns { authorized: true } or { authorized: false, status, error }.
 */
async function authorizeTaskAccess(req, task) {
  const actor = getActor(req);
  if (!actor) return { authorized: false, status: 401, error: 'Authentication required' };
  if (actor.is_admin) return { authorized: true };

  const callerPid = actor.person_id;

  // Owner / assignee check
  if (task.created_by === callerPid || task.assigned_to === callerPid ||
      task.plan_created_by === callerPid) {
    return { authorized: true };
  }

  // Supervisor-level override
  if (actor.role_level >= 3) {
    // Still must be same company when multi-tenant
    if (req.companyId) {
      const ownerPid = task.assigned_to || task.created_by || task.plan_created_by;
      if (ownerPid) {
        const owner = await (req.db || DB).people.getById(ownerPid);
        if (!owner || owner.company_id !== req.companyId) {
          return { authorized: false, status: 403, error: 'Not authorized — task belongs to a different company' };
        }
      }
    }
    return { authorized: true };
  }

  return { authorized: false, status: 403, error: 'Not authorized to access this task' };
}

const router = Router();

// Photo upload for task days
const photoStorage = multer.diskStorage({
  destination: path.join(__dirname, '../../photos'),
  filename: (req, file, cb) => {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = file.originalname.split('.').pop() || 'jpg';
    cb(null, `task_${ts}.${ext}`);
  }
});
const photoUpload = multer({ storage: photoStorage, limits: { fileSize: 20 * 1024 * 1024 } });

// GET /api/tasks/active/:person_id — all active (non-completed) tasks, enriched with JSA status
router.get('/active/:person_id', requireAuth, requireSelfOrRoleLevel('person_id', 3), async (req, res) => {
  try {
    const person = await (req.db || DB).people.getById(req.params.person_id);
    if (!person) return res.status(404).json({ error: 'Person not found' });
    const isSupervisor = (person.role_level || 1) >= 2;
    const tasks = isSupervisor
      ? await (req.db || DB).dailyPlans.getActiveTasksForSupervisor(req.params.person_id)
      : await (req.db || DB).dailyPlans.getActiveTasks(req.params.person_id);

    // Enrich with JSA status for today
    const today = new Date().toISOString().split('T')[0];
    const enriched = [];
    for (const task of tasks) {
      if (!task.assigned_to) { enriched.push({ ...task, jsa_status: 'unknown' }); continue; }
      try {
        let jsaQuery = "SELECT id, form_data, jsa_number FROM jsa_records WHERE date = $1 AND status != 'rejected' AND (person_id = $2 OR crew_members LIKE $3)";
        const jsaParams = [today, task.assigned_to, `%${task.assigned_to}%`];
        if (req.companyId) { jsaParams.push(req.companyId); jsaQuery += ` AND company_id = $${jsaParams.length}`; }
        const jsas = (await (req.db || DB).db.query(jsaQuery, jsaParams)).rows;
        if (jsas.length === 0) { enriched.push({ ...task, jsa_status: 'no_jsa' }); continue; }
        const taskWords = ((task.title || '') + ' ' + (task.description || '')).toLowerCase().split(/\s+/).filter(w => w.length > 3);
        if (taskWords.length === 0) { enriched.push({ ...task, jsa_status: 'has_jsa', jsa_number: jsas[0].jsa_number }); continue; }
        let matched = false;
        for (const jsa of jsas) {
          let fd; try { fd = JSON.parse(jsa.form_data || '{}'); } catch { fd = {}; }
          const jsaWords = ((fd.task_description || '') + ' ' + (fd.work_area || '')).toLowerCase().split(/\s+/).filter(w => w.length > 3);
          const overlap = taskWords.filter(w => jsaWords.includes(w)).length;
          if (overlap / taskWords.length >= 0.3) { enriched.push({ ...task, jsa_status: 'match', jsa_number: jsa.jsa_number }); matched = true; break; }
        }
        if (!matched) enriched.push({ ...task, jsa_status: 'mismatch', jsa_number: jsas[0].jsa_number });
      } catch { enriched.push({ ...task, jsa_status: 'unknown' }); }
    }

    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/tasks/all/:person_id — all tasks (with optional filters)
router.get('/all/:person_id', requireAuth, requireSelfOrRoleLevel('person_id', 3), async (req, res) => {
  try {
    // Company isolation — verify target person exists and is in the same company
    if (req.companyId) {
      const target = await (req.db || DB).people.getById(req.params.person_id);
      if (!target || target.company_id !== req.companyId) return res.status(404).json({ error: 'Not found' });
    }
    const filters = {};
    if (req.query.status) filters.status = req.query.status;
    if (req.query.trade) filters.trade = req.query.trade;
    const tasks = await (req.db || DB).dailyPlans.getAllTasksForPerson(req.params.person_id, filters);
    res.json(tasks);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/tasks/:task_id — task detail with full history
router.get('/:task_id', requireAuth, async (req, res) => {
  try {
    const task = await (req.db || DB).dailyPlans.getTaskWithHistory(req.params.task_id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const authCheck = await authorizeTaskAccess(req, task);
    if (!authCheck.authorized) return res.status(authCheck.status).json({ error: authCheck.error });
    res.json(task);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/tasks/:task_id/days — all daily entries for a task
router.get('/:task_id/days', requireAuth, async (req, res) => {
  try {
    const task = await (req.db || DB).dailyPlans.getTaskById(req.params.task_id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const authCheck = await authorizeTaskAccess(req, task);
    if (!authCheck.authorized) return res.status(authCheck.status).json({ error: authCheck.error });
    const days = await (req.db || DB).taskDays.getForTask(req.params.task_id);
    res.json(days);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/tasks/:task_id/days/:date — get or create today's entry
router.get('/:task_id/days/:date', requireAuth, async (req, res) => {
  try {
    const actor = getActor(req);
    const task = await (req.db || DB).dailyPlans.getTaskById(req.params.task_id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const authCheck = await authorizeTaskAccess(req, task);
    if (!authCheck.authorized) return res.status(authCheck.status).json({ error: authCheck.error });
    // Derive person_id from session, fallback to task assigned_to
    const personId = actor.person_id || task.assigned_to;
    const day = await (req.db || DB).taskDays.getOrCreate(req.params.task_id, req.params.date, personId);
    res.json(day);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/tasks — create a new persistent task
router.post('/', requireAuth, requireSparksEditMode, async (req, res) => {
  try {
    const actor = getActor(req);
    const { title, description, assigned_to, priority, trade, location, date } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    // DERIVE created_by from session
    const created_by = actor.person_id;
    const taskDate = date || new Date().toISOString().split('T')[0];
    const plan = await (req.db || DB).dailyPlans.getOrCreate(taskDate, created_by, trade);
    const result = await (req.db || DB).dailyPlans.addTask({
      plan_id: plan.id, assigned_to, title, description, priority,
    });
    if (result.id) {
      const sets = [];
      const vals = [];
      let paramIdx = 1;
      sets.push(`start_date = $${paramIdx}`); vals.push(taskDate); paramIdx++;
      sets.push(`created_by = $${paramIdx}`); vals.push(created_by); paramIdx++;
      if (trade) { sets.push(`trade = $${paramIdx}`); vals.push(trade); paramIdx++; }
      if (location) { sets.push(`location = $${paramIdx}`); vals.push(location); paramIdx++; }
      vals.push(result.id);
      await (req.db || DB).db.query(`UPDATE daily_plan_tasks SET ${sets.join(', ')} WHERE id = $${paramIdx}`, vals);
    }
    const task = await (req.db || DB).dailyPlans.getTaskById(result.id);
    res.json(task);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/tasks/:task_id — update task
router.put('/:task_id', requireAuth, requireSparksEditMode, async (req, res) => {
  try {
    const existingTask = await (req.db || DB).dailyPlans.getTaskById(req.params.task_id);
    if (!existingTask) return res.status(404).json({ error: 'Task not found' });
    const authCheck = await authorizeTaskAccess(req, existingTask);
    if (!authCheck.authorized) return res.status(authCheck.status).json({ error: authCheck.error });
    const result = await (req.db || DB).dailyPlans.updateTask(req.params.task_id, req.body);
    if (req.body.target_end_date !== undefined || req.body.location !== undefined || req.body.trade !== undefined) {
      const sets = [];
      const vals = [];
      let paramIdx = 1;
      if (req.body.target_end_date !== undefined) { sets.push(`target_end_date = $${paramIdx}`); vals.push(req.body.target_end_date); paramIdx++; }
      if (req.body.location !== undefined) { sets.push(`location = $${paramIdx}`); vals.push(req.body.location); paramIdx++; }
      if (req.body.trade !== undefined) { sets.push(`trade = $${paramIdx}`); vals.push(req.body.trade); paramIdx++; }
      if (sets.length > 0) {
        vals.push(req.params.task_id);
        await (req.db || DB).db.query(`UPDATE daily_plan_tasks SET ${sets.join(', ')} WHERE id = $${paramIdx}`, vals);
      }
    }
    const task = await (req.db || DB).dailyPlans.getTaskById(req.params.task_id);
    res.json(task);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/tasks/:task_id/days/:date/shift — save shift update
router.post('/:task_id/days/:date/shift', requireAuth, requireSparksEditMode, async (req, res) => {
  try {
    const actor = getActor(req);
    const { shift_notes, shift_audio, shift_transcript, shift_structured, shift_conversation, hours_worked } = req.body;
    const task = await (req.db || DB).dailyPlans.getTaskById(req.params.task_id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const authCheck = await authorizeTaskAccess(req, task);
    if (!authCheck.authorized) return res.status(authCheck.status).json({ error: authCheck.error });
    // DERIVE person_id from session
    const pId = actor.person_id || task.assigned_to;
    const day = await (req.db || DB).taskDays.getOrCreate(req.params.task_id, req.params.date, pId);
    await (req.db || DB).taskDays.update(day.id, {
      shift_notes, shift_audio, shift_transcript, shift_structured, shift_conversation, hours_worked,
    });
    const updated = await (req.db || DB).taskDays.getForDate(req.params.task_id, req.params.date);
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/tasks/:task_id/days/:date — update a day entry
router.put('/:task_id/days/:date', requireAuth, requireSparksEditMode, async (req, res) => {
  try {
    const task = await (req.db || DB).dailyPlans.getTaskById(req.params.task_id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const authCheck = await authorizeTaskAccess(req, task);
    if (!authCheck.authorized) return res.status(authCheck.status).json({ error: authCheck.error });
    const day = await (req.db || DB).taskDays.getForDate(req.params.task_id, req.params.date);
    if (!day) return res.status(404).json({ error: 'No entry for this date' });
    await (req.db || DB).taskDays.update(day.id, req.body);
    const updated = await (req.db || DB).taskDays.getForDate(req.params.task_id, req.params.date);
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/tasks/:task_id/days/:date/photos — upload photo
router.post('/:task_id/days/:date/photos', requireAuth, requireSparksEditMode, photoUpload.single('photo'), async (req, res) => {
  try {
    const actor = getActor(req);
    if (!req.file) return res.status(400).json({ error: 'No photo provided' });
    const task = await (req.db || DB).dailyPlans.getTaskById(req.params.task_id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const authCheck = await authorizeTaskAccess(req, task);
    if (!authCheck.authorized) return res.status(authCheck.status).json({ error: authCheck.error });
    // DERIVE person_id from session
    const pId = actor.person_id || task.assigned_to;
    const day = await (req.db || DB).taskDays.getOrCreate(req.params.task_id, req.params.date, pId);
    const photos = day.photos || [];
    photos.push(req.file.filename);
    await (req.db || DB).taskDays.update(day.id, { photos });
    res.json({ success: true, filename: req.file.filename, photos });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/tasks/:task_id/note — add a note
router.post('/:task_id/note', requireAuth, requireSparksEditMode, async (req, res) => {
  try {
    const actor = getActor(req);
    const { note, date } = req.body;
    if (!note) return res.status(400).json({ error: 'Note text required' });
    const task = await (req.db || DB).dailyPlans.getTaskById(req.params.task_id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const authCheck = await authorizeTaskAccess(req, task);
    if (!authCheck.authorized) return res.status(authCheck.status).json({ error: authCheck.error });
    // DERIVE person_id from session
    const pId = actor.person_id || task.assigned_to;
    const day = await (req.db || DB).taskDays.getOrCreate(req.params.task_id, date || new Date().toISOString().split('T')[0], pId);
    const notes = day.notes || [];
    notes.push({ text: note, time: new Date().toISOString(), by: pId });
    await (req.db || DB).taskDays.update(day.id, { notes });
    res.json({ success: true, notes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/tasks/:task_id/report — full report package
router.get('/:task_id/report', requireAuth, async (req, res) => {
  try {
    const task = await (req.db || DB).dailyPlans.getTaskWithHistory(req.params.task_id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const authCheck = await authorizeTaskAccess(req, task);
    if (!authCheck.authorized) return res.status(authCheck.status).json({ error: authCheck.error });
    const days = task.days || [];
    const stats = {
      total_days: days.length,
      total_hours: days.reduce((sum, d) => sum + (d.hours_worked || 0), 0),
      jsa_count: days.filter(d => d.jsa_id).length,
      photo_count: days.reduce((sum, d) => sum + (d.photos || []).length, 0),
      form_count: days.reduce((sum, d) => sum + (d.forms || []).length, 0),
      shift_update_count: days.filter(d => d.shift_structured || d.shift_notes).length,
    };
    res.json({ task, days, stats });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/tasks/:task_id/context — AI context for shift updates
router.get('/:task_id/context', requireAuth, async (req, res) => {
  try {
    const task = await (req.db || DB).dailyPlans.getTaskById(req.params.task_id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const authCheck = await authorizeTaskAccess(req, task);
    if (!authCheck.authorized) return res.status(authCheck.status).json({ error: authCheck.error });
    const recentDays = await (req.db || DB).taskDays.getRecentForTask(req.params.task_id, 3);
    const today = req.query.date || new Date().toISOString().split('T')[0];
    const todayEntry = await (req.db || DB).taskDays.getForDate(req.params.task_id, today);
    let jsaSummary = null;
    if (todayEntry && todayEntry.jsa_id) {
      try {
        const formData = todayEntry.jsa_form_data ? JSON.parse(todayEntry.jsa_form_data) : {};
        const hazardSteps = [];
        for (let i = 1; i <= 5; i++) {
          const task_step = formData[`step${i}_task`];
          const hazards = formData[`step${i}_hazards`];
          const controls = formData[`step${i}_controls`];
          if (task_step) hazardSteps.push(`Step: ${task_step}. Hazards: ${hazards || 'N/A'}. Controls: ${controls || 'N/A'}`);
        }
        jsaSummary = hazardSteps.join(' | ');
      } catch(e) {}
    }
    const previousUpdates = recentDays.map(d => ({
      date: d.date,
      summary: d.shift_structured || d.shift_notes || '',
      hours: d.hours_worked,
      jsa_number: d.jsa_number,
    }));
    res.json({
      task_title: task.title,
      task_description: task.description,
      task_location: task.location,
      task_trade: task.trade,
      jsa_summary: jsaSummary,
      previous_updates: previousUpdates,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/tasks/:taskId/days/:date/link-jsa
router.put('/:taskId/days/:date/link-jsa', requireAuth, requireSparksEditMode, async (req, res) => {
  try {
    const { taskId, date } = req.params;
    const { jsa_id } = req.body;
    if (!jsa_id) return res.status(400).json({ error: 'jsa_id required' });
    const task = await (req.db || DB).dailyPlans.getTaskById(taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const authCheck = await authorizeTaskAccess(req, task);
    if (!authCheck.authorized) return res.status(authCheck.status).json({ error: authCheck.error });
    const day = await (req.db || DB).taskDays.getOrCreate(taskId, date, task.assigned_to);
    await (req.db || DB).taskDays.update(day.id, { jsa_id });
    res.json({ success: true, day_id: day.id, jsa_id });
  } catch (err) {
    console.error('Link JSA error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
