const express = require('express');
const router = express.Router();
const { requireAuth, requireRoleLevel, requireSparksEditMode } = require('../middleware/sessionAuth');
const { getActor } = require('../auth/authz');
const DB = require('../../database/db');

module.exports = function(db) {

  // ============================================
  // JSA Tables — async initialization
  // ============================================
  (async () => {
    // Main JSA record (the "Setup" — created by foreman or lead worker)
    await db.query(`
      CREATE TABLE IF NOT EXISTS jsa_records (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL,
        person_name TEXT NOT NULL,
        trade TEXT,
        date TEXT NOT NULL,
        status TEXT DEFAULT 'draft',
        mode TEXT DEFAULT 'shared',
        form_data TEXT DEFAULT '{}',
        supervisor_id TEXT,
        foreman_id TEXT,
        foreman_name TEXT,
        foreman_approved_at TEXT,
        safety_id TEXT,
        safety_name TEXT,
        safety_approved_at TEXT,
        rejection_reason TEXT,
        crew_members TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (NOW()),
        updated_at TEXT DEFAULT (NOW())
      )
    `);

    // Individual acknowledgments (Part 2 — each crew member fills this out)
    await db.query(`
      CREATE TABLE IF NOT EXISTS jsa_acknowledgments (
        id TEXT PRIMARY KEY,
        jsa_id TEXT NOT NULL,
        person_id TEXT NOT NULL,
        person_name TEXT NOT NULL,
        role_title TEXT,
        my_task TEXT,
        my_hazards TEXT,
        my_controls TEXT,
        ai_conversation TEXT DEFAULT '[]',
        signature TEXT,
        acknowledged_at TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT (NOW()),
        FOREIGN KEY (jsa_id) REFERENCES jsa_records(id)
      )
    `);

    // Add mode column if missing (for existing databases)
    try { await db.query("ALTER TABLE jsa_records ADD COLUMN mode TEXT DEFAULT 'shared'"); } catch(e) {}
    // Link JSA to a task (task-centric model)
    try { await db.query("ALTER TABLE jsa_records ADD COLUMN task_id TEXT"); } catch(e) {}
    try { await db.query("ALTER TABLE jsa_records ADD COLUMN jsa_number TEXT"); } catch(e) {}
    // Multi-tenancy: company_id for data isolation
    try { await db.query("ALTER TABLE jsa_records ADD COLUMN company_id TEXT"); } catch(e) {}
    // Backfill company_id from person_id for existing records
    try { await db.query("UPDATE jsa_records SET company_id = p.company_id FROM people p WHERE jsa_records.person_id = p.id AND jsa_records.company_id IS NULL"); } catch(e) {}
  })();

  // ============================================
  // GET — My JSAs (own + shared with me + pending acknowledgments)
  // ============================================
  router.get('/', requireAuth, async (req, res) => {
    const { person_id } = req.query;
    if (!person_id) return res.json({ jsas: [], shared_with_me: [], my_acknowledgments: [] });

    try {
      // JSAs I created — scoped by company
      let ownQuery = 'SELECT * FROM jsa_records WHERE person_id = $1';
      const ownParams = [person_id];
      if (req.companyId) { ownParams.push(req.companyId); ownQuery += ` AND company_id = $${ownParams.length}`; }
      ownQuery += ' ORDER BY date DESC LIMIT 30';
      const own = (await (req.db || DB).db.query(ownQuery, ownParams)).rows;

      // JSAs shared with me (I'm in crew_members) — scoped by company
      let sharedQuery = "SELECT * FROM jsa_records WHERE date >= CURRENT_DATE - INTERVAL '7 days' AND status != 'draft'";
      const sharedParams = [];
      if (req.companyId) { sharedParams.push(req.companyId); sharedQuery += ` AND company_id = $${sharedParams.length}`; }
      sharedQuery += ' ORDER BY date DESC';
      const allRecent = (await (req.db || DB).db.query(sharedQuery, sharedParams)).rows;
      const sharedWithMe = allRecent.filter(j => {
        const crew = JSON.parse(j.crew_members || '[]');
        return crew.some(c => c.id === person_id || c.person_id === person_id);
      });

      // My pending acknowledgments
      const myAcks = (await (req.db || DB).db.query('SELECT a.*, j.date as jsa_date, j.form_data as jsa_form_data, j.person_name as creator_name FROM jsa_acknowledgments a JOIN jsa_records j ON a.jsa_id = j.id WHERE a.person_id = $1 ORDER BY a.created_at DESC LIMIT 20', [person_id])).rows;

      const jsas = [];
      for (const j of own) {
        jsas.push({
          ...j,
          form_data: JSON.parse(j.form_data || '{}'),
          crew_members: JSON.parse(j.crew_members || '[]'),
          acknowledgments: await getAcknowledgments(j.id, req.db),
        });
      }

      const shared = [];
      for (const j of sharedWithMe.filter(j => !own.find(o => o.id === j.id))) {
        shared.push({
          ...j,
          form_data: JSON.parse(j.form_data || '{}'),
          crew_members: JSON.parse(j.crew_members || '[]'),
          my_acknowledgment: myAcks.find(a => a.jsa_id === j.id) || null,
        });
      }

      const pendingAcks = myAcks.filter(a => a.status === 'pending').map(a => ({
        ...a,
        jsa_form_data: JSON.parse(a.jsa_form_data || '{}'),
        ai_conversation: JSON.parse(a.ai_conversation || '[]'),
      }));

      res.json({ jsas, shared_with_me: shared, pending_acknowledgments: pendingAcks });
    } catch (err) {
      console.error('JSA fetch error:', err);
      res.status(500).json({ error: 'Failed to fetch JSAs' });
    }
  });

  // Helper: get signatures for a JSA
  async function getAcknowledgments(jsaId, reqDb) {
    return (await (reqDb || DB).db.query('SELECT * FROM jsa_acknowledgments WHERE jsa_id = $1 ORDER BY created_at', [jsaId])).rows;
  }

  // ============================================
  // GET — Pending approvals for foreman/safety
  // ============================================
  router.get('/pending', requireAuth, async (req, res) => {
    const { approver_id, role } = req.query;
    if (!approver_id) return res.json({ pending: [] });

    try {
      let pending;
      if (role === 'safety') {
        if (req.companyId) {
          pending = (await (req.db || DB).db.query('SELECT * FROM jsa_records WHERE status = $1 AND company_id = $2 ORDER BY date DESC', ['pending_safety', req.companyId])).rows;
        } else {
          pending = (await (req.db || DB).db.query('SELECT * FROM jsa_records WHERE status = $1 ORDER BY date DESC', ['pending_safety'])).rows;
        }
      } else {
        pending = (await (req.db || DB).db.query('SELECT * FROM jsa_records WHERE status = $1 AND supervisor_id = $2 ORDER BY date DESC', ['pending_foreman', approver_id])).rows;
      }

      const parsed = [];
      for (const j of pending) {
        parsed.push({
          ...j,
          form_data: JSON.parse(j.form_data || '{}'),
          crew_members: JSON.parse(j.crew_members || '[]'),
          acknowledgments: await getAcknowledgments(j.id, req.db),
        });
      }

      res.json({ pending: parsed });
    } catch (err) {
      console.error('JSA pending fetch error:', err);
      res.status(500).json({ error: 'Failed to fetch pending JSAs' });
    }
  });

  // ============================================
  // POST — Create a new JSA
  // ============================================
  router.post('/', requireAuth, requireSparksEditMode, async (req, res) => {
    const actor = getActor(req);
    const { person_id, person_name, trade, date, status, form_data, supervisor_id, crew_members, mode, task_id } = req.body;
    const id = 'jsa_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

    try {
      // Auto-generate JSA number
      const year = new Date().getFullYear();
      await (req.db || DB).db.query('INSERT INTO jsa_sequence (year, last_number) VALUES ($1, 0) ON CONFLICT DO NOTHING', [year]);
      await (req.db || DB).db.query('UPDATE jsa_sequence SET last_number = last_number + 1 WHERE year = $1', [year]);
      const seq = (await (req.db || DB).db.query('SELECT last_number FROM jsa_sequence WHERE year = $1', [year])).rows[0];
      const jsaNumber = `JSA-${year}-${String(seq.last_number).padStart(4, '0')}`;

      // Derive company_id from session or from the person record
      let companyId = req.companyId;
      if (!companyId && person_id) {
        try {
          const personRow = (await (req.db || DB).db.query('SELECT company_id FROM people WHERE id = $1', [person_id])).rows[0];
          companyId = personRow?.company_id || null;
        } catch(e) {}
      }

      await (req.db || DB).db.query(`
        INSERT INTO jsa_records (id, person_id, person_name, trade, date, status, form_data, supervisor_id, crew_members, mode, jsa_number, task_id, company_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `, [id, person_id, person_name, trade || '', date, status || 'draft', JSON.stringify(form_data || {}), supervisor_id || null, JSON.stringify(crew_members || []), mode || 'shared', jsaNumber, task_id || null, companyId]);

      // If linked to a task, update the task_day's jsa_id
      if (task_id) {
        try {
          const DB = require('../../database/db');
          const day = await (req.db || DB).taskDays.getOrCreate(task_id, date, person_id);
          await (req.db || DB).taskDays.update(day.id, { jsa_id: id });
        } catch(e) { console.error('Task-day JSA link error:', e.message); }
      }

      // If crew members provided and mode is 'shared', create acknowledgment records for each
      const crew = crew_members || [];
      if (crew.length > 0 && mode !== 'individual') {
        for (const member of crew) {
          const ackId = 'ack_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
          await (req.db || DB).db.query(`
            INSERT INTO jsa_acknowledgments (id, jsa_id, person_id, person_name, role_title, status)
            VALUES ($1, $2, $3, $4, $5, 'pending')
          `, [ackId, id, member.id || member.person_id, member.name || member.person_name, member.role_title || '']);
        }
      }

      res.json({ success: true, id, jsa_number: jsaNumber });
    } catch (err) {
      console.error('JSA create error:', err);
      res.status(500).json({ error: 'Failed to create JSA' });
    }
  });

  // ============================================
  // PUT — Update JSA form data
  // ============================================
  router.put('/:id', requireAuth, requireSparksEditMode, async (req, res) => {
    const { id } = req.params;
    const { form_data, crew_members, status } = req.body;

    try {
      const updates = [];
      const values = [];
      let paramIdx = 1;

      if (form_data !== undefined) { updates.push(`form_data = $${paramIdx++}`); values.push(JSON.stringify(form_data)); }
      if (crew_members !== undefined) { updates.push(`crew_members = $${paramIdx++}`); values.push(JSON.stringify(crew_members)); }
      if (status !== undefined) { updates.push(`status = $${paramIdx++}`); values.push(status); }
      updates.push('updated_at = NOW()');
      values.push(id);

      await (req.db || DB).db.query(`UPDATE jsa_records SET ${updates.join(', ')} WHERE id = $${paramIdx}`, values);

      // If crew members updated, create new acknowledgment records for any new members
      if (crew_members) {
        const existingAcks = (await (req.db || DB).db.query('SELECT person_id FROM jsa_acknowledgments WHERE jsa_id = $1', [id])).rows;
        const existingIds = new Set(existingAcks.map(a => a.person_id));

        for (const member of crew_members) {
          const memberId = member.id || member.person_id;
          if (!existingIds.has(memberId)) {
            const ackId = 'ack_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
            await (req.db || DB).db.query(`
              INSERT INTO jsa_acknowledgments (id, jsa_id, person_id, person_name, role_title, status)
              VALUES ($1, $2, $3, $4, $5, 'pending')
            `, [ackId, id, memberId, member.name || member.person_name, member.role_title || '']);
          }
        }
      }

      res.json({ success: true });
    } catch (err) {
      console.error('JSA update error:', err);
      res.status(500).json({ error: 'Failed to update JSA' });
    }
  });

  // ============================================
  // POST — Submit JSA for approval
  // ============================================
  router.post('/:id/submit', requireAuth, requireSparksEditMode, async (req, res) => {
    const { id } = req.params;
    try {
      await (req.db || DB).db.query("UPDATE jsa_records SET status = $1, updated_at = NOW() WHERE id = $2",
        ['pending_foreman', id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to submit JSA' });
    }
  });

  // ============================================
  // POST — Sign JSA (crew member signature)
  // ============================================
  router.post('/sign', requireAuth, requireSparksEditMode, async (req, res) => {
    const { ack_id, jsa_id, person_id, person_name, signature, signed_on_device } = req.body;

    try {
      if (ack_id) {
        // Sign existing record (crew member on their own phone)
        await (req.db || DB).db.query(`
          UPDATE jsa_acknowledgments
          SET signature = $1, signed_at = NOW(), signed_on_device = $2, status = 'signed'
          WHERE id = $3
        `, [signature || 'signed', signed_on_device || 'own', ack_id]);
      } else {
        // Add and sign (foreman signing for someone on their phone)
        const newId = 'ack_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        await (req.db || DB).db.query(`
          INSERT INTO jsa_acknowledgments (id, jsa_id, person_id, person_name, role_title, signature, signed_at, signed_on_device, status)
          VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, 'signed')
        `, [newId, jsa_id, person_id || 'manual', person_name || '', req.body.role_title || '', signature || 'signed', signed_on_device || 'foreman']);
      }

      // Check if all crew members have signed
      const jsa = (await (req.db || DB).db.query('SELECT * FROM jsa_records WHERE id = $1', [jsa_id])).rows[0];
      if (jsa) {
        const allAcks = (await (req.db || DB).db.query('SELECT * FROM jsa_acknowledgments WHERE jsa_id = $1', [jsa_id])).rows;
        const completedCount = allAcks.filter(a => a.status === 'signed').length;
        const totalCount = allAcks.length;

        res.json({
          success: true,
          all_acknowledged: completedCount === totalCount && totalCount > 0,
          completed: completedCount,
          total: totalCount
        });
      } else {
        res.json({ success: true });
      }
    } catch (err) {
      console.error('JSA acknowledge error:', err);
      res.status(500).json({ error: 'Failed to acknowledge JSA' });
    }
  });

  // ============================================
  // GET — Acknowledgments for a specific JSA
  // ============================================
  router.get('/:id/acknowledgments', requireAuth, async (req, res) => {
    const { id } = req.params;
    try {
      const acks = await getAcknowledgments(id);
      const completed = acks.filter(a => a.status === 'completed').length;
      res.json({ acknowledgments: acks, completed, total: acks.length });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch acknowledgments' });
    }
  });

  // ============================================
  // POST — Approve JSA (foreman or safety)
  // ============================================
  router.post('/:id/approve', requireAuth, requireSparksEditMode, requireRoleLevel(3), async (req, res) => {
    const actor = getActor(req);
    const { id } = req.params;
    // DERIVE approver identity from session
    const approver_id = actor.person_id;
    const { role } = req.body;
    let approver_name = '';
    try {
      const p = await (req.db || DB).db.query('SELECT name FROM people WHERE id = $1', [approver_id]);
      approver_name = p.rows[0]?.name || '';
    } catch {};

    try {
      const jsa = (await (req.db || DB).db.query('SELECT * FROM jsa_records WHERE id = $1', [id])).rows[0];
      if (!jsa) return res.status(404).json({ error: 'JSA not found' });

      if (role === 'foreman') {
        await (req.db || DB).db.query("UPDATE jsa_records SET status = $1, foreman_id = $2, foreman_name = $3, foreman_approved_at = NOW(), updated_at = NOW() WHERE id = $4",
          ['pending_safety', approver_id, approver_name, id]);
      } else if (role === 'safety') {
        await (req.db || DB).db.query("UPDATE jsa_records SET status = $1, safety_id = $2, safety_name = $3, safety_approved_at = NOW(), updated_at = NOW() WHERE id = $4",
          ['active', approver_id, approver_name, id]);
      }

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to approve JSA' });
    }
  });

  // ============================================
  // POST — Reject JSA
  // ============================================
  router.post('/:id/reject', requireAuth, requireSparksEditMode, requireRoleLevel(3), async (req, res) => {
    const actor = getActor(req);
    const { id } = req.params;
    // DERIVE approver identity from session
    const approver_id = actor.person_id;
    const { role, reason } = req.body;

    try {
      await (req.db || DB).db.query("UPDATE jsa_records SET status = $1, rejection_reason = $2, updated_at = NOW() WHERE id = $3",
        ['rejected', reason || 'No reason provided', id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to reject JSA' });
    }
  });

  // ============================================
  // GET — Today's active JSAs (for dashboard/overview)
  // ============================================
  router.get('/today', requireAuth, async (req, res) => {
    const { trade } = req.query;
    try {
      let query = "SELECT * FROM jsa_records WHERE date = CURRENT_DATE::text AND status = 'active'";
      const params = [];
      let paramIdx = 1;
      if (req.companyId) { query += ` AND company_id = $${paramIdx++}`; params.push(req.companyId); }
      if (trade) { query += ` AND trade = $${paramIdx++}`; params.push(trade); }
      query += ' ORDER BY created_at DESC';

      const rows = (await (req.db || DB).db.query(query, params)).rows;
      const jsas = [];
      for (const j of rows) {
        jsas.push({
          ...j,
          form_data: JSON.parse(j.form_data || '{}'),
          crew_members: JSON.parse(j.crew_members || '[]'),
          acknowledgments: await getAcknowledgments(j.id, req.db),
        });
      }

      res.json({ jsas });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch today JSAs' });
    }
  });

  // ============================================
  // AI JSA Mismatch Detection
  // ============================================

  router.post('/match-check', requireAuth, requireSparksEditMode, async (req, res) => {
    try {
      const { jsa_task_description, task_title, task_description } = req.body;
      if (!jsa_task_description || !task_title) {
        return res.status(400).json({ error: 'jsa_task_description and task_title required' });
      }

      if (!process.env.ANTHROPIC_API_KEY) {
        // Fallback to keyword matching if no API key
        const jsaWords = jsa_task_description.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const taskWords = (task_title + ' ' + (task_description || '')).toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const overlap = taskWords.filter(w => jsaWords.includes(w)).length;
        const score = taskWords.length > 0 ? overlap / taskWords.length : 0;
        return res.json({
          match: score >= 0.3,
          confidence: 'low',
          reason: score >= 0.3 ? 'Keyword overlap detected' : 'Low keyword overlap — tasks may differ',
          missing_hazards: [],
        });
      }

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          messages: [{
            role: 'user',
            content: `You are a construction safety expert. Compare this JSA (Job Safety Analysis) task description against the assigned work task. Determine if the JSA adequately covers the hazards of this task.

JSA Task Description: "${jsa_task_description}"

Assigned Task: "${task_title}"${task_description ? `\nTask Details: "${task_description}"` : ''}

Return ONLY valid JSON (no markdown): { "match": boolean, "confidence": "high"|"medium"|"low", "reason": "brief explanation", "missing_hazards": ["hazard1", "hazard2"] }
If the work is substantially the same, match=true. If different work types, locations, or equipment, match=false with missing_hazards.`,
          }],
        }),
      });

      if (aiRes.ok) {
        const data = await aiRes.json();
        const text = data.content[0].text;
        try {
          const result = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
          return res.json(result);
        } catch {
          return res.json({ match: false, confidence: 'low', reason: 'AI response could not be parsed', missing_hazards: [] });
        }
      }
      res.json({ match: false, confidence: 'low', reason: 'AI service unavailable', missing_hazards: [] });
    } catch (err) {
      console.error('JSA match-check error:', err);
      res.json({ match: false, confidence: 'low', reason: 'Error checking match', missing_hazards: [] });
    }
  });

  // ============================================
  // JSA Status — Batch check for persons
  // ============================================

  // POST /api/jsa/status/batch — check JSA status for multiple persons on a date
  router.post('/status/batch', requireAuth, requireSparksEditMode, async (req, res) => {
    try {
      const { person_ids, date, task_title, task_description } = req.body;
      if (!person_ids || !date) return res.status(400).json({ error: 'person_ids and date required' });

      const today = date || new Date().toISOString().split('T')[0];
      // Get all JSAs for this date — scoped by company
      let batchQuery = "SELECT * FROM jsa_records WHERE date = $1 AND status != 'rejected'";
      const batchParams = [today];
      if (req.companyId) { batchParams.push(req.companyId); batchQuery += ` AND company_id = $${batchParams.length}`; }
      const allJsas = (await (req.db || DB).db.query(batchQuery, batchParams)).rows;

      const taskWords = ((task_title || '') + ' ' + (task_description || '')).toLowerCase().split(/\s+/).filter(w => w.length > 3);

      const result = {};
      for (const pid of person_ids) {
        // Find JSAs where this person is creator or crew member
        const personJsas = allJsas.filter(j => {
          if (j.person_id === pid) return true;
          try {
            const crew = JSON.parse(j.crew_members || '[]');
            return crew.some(c => c.id === pid || c.person_id === pid);
          } catch { return false; }
        });

        if (personJsas.length === 0) {
          result[pid] = { status: 'no_jsa' };
          continue;
        }

        // Check if any JSA matches the task (keyword overlap)
        let bestMatch = null;
        let bestScore = 0;
        for (const jsa of personJsas) {
          let formData;
          try { formData = JSON.parse(jsa.form_data || '{}'); } catch { formData = {}; }
          const jsaDesc = ((formData.task_description || '') + ' ' + (formData.work_area || '')).toLowerCase();

          if (taskWords.length === 0) {
            // No task to compare — just has a JSA
            bestMatch = jsa;
            bestScore = -1; // has_jsa, not match
            break;
          }

          const jsaWords = jsaDesc.split(/\s+/).filter(w => w.length > 3);
          const overlap = taskWords.filter(w => jsaWords.includes(w)).length;
          const score = taskWords.length > 0 ? overlap / taskWords.length : 0;
          if (score > bestScore) {
            bestScore = score;
            bestMatch = jsa;
          }
        }

        if (!bestMatch) {
          result[pid] = { status: 'has_jsa', jsa_id: personJsas[0].id, jsa_number: personJsas[0].jsa_number };
        } else if (bestScore === -1 || taskWords.length === 0) {
          result[pid] = { status: 'has_jsa', jsa_id: bestMatch.id, jsa_number: bestMatch.jsa_number };
        } else if (bestScore >= 0.3) {
          let fd; try { fd = JSON.parse(bestMatch.form_data || '{}'); } catch { fd = {}; }
          result[pid] = { status: 'match', jsa_id: bestMatch.id, jsa_number: bestMatch.jsa_number, task_description: fd.task_description };
        } else {
          let fd; try { fd = JSON.parse(bestMatch.form_data || '{}'); } catch { fd = {}; }
          result[pid] = { status: 'mismatch', jsa_id: bestMatch.id, jsa_number: bestMatch.jsa_number, task_description: fd.task_description };
        }
      }

      res.json(result);
    } catch (err) {
      console.error('JSA batch status error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/jsa/status/:personId — single person JSA status
  router.get('/status/:personId', requireAuth, async (req, res) => {
    const { personId } = req.params;
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const task_title = req.query.task_title || '';
    const task_description = req.query.task_description || '';

    // Reuse batch logic
    const fakeReq = { body: { person_ids: [personId], date, task_title, task_description } };
    const fakeRes = {
      json: (data) => res.json(data[personId] || { status: 'no_jsa' }),
      status: (code) => ({ json: (data) => res.status(code).json(data) }),
    };
    router.handle({ ...req, method: 'POST', url: '/status/batch', body: fakeReq.body }, fakeRes, () => {});
  });

  // GET /api/jsa/person/:personId/today — get person's JSAs for today (for linking)
  router.get('/person/:personId/today', requireAuth, async (req, res) => {
    try {
      const { personId } = req.params;
      const today = req.query.date || new Date().toISOString().split('T')[0];

      // JSAs created by this person today — scoped by company
      let ownQuery = "SELECT * FROM jsa_records WHERE person_id = $1 AND date = $2 AND status != 'rejected'";
      const ownParams = [personId, today];
      if (req.companyId) { ownParams.push(req.companyId); ownQuery += ` AND company_id = $${ownParams.length}`; }
      ownQuery += ' ORDER BY created_at DESC';
      const own = (await (req.db || DB).db.query(ownQuery, ownParams)).rows;

      // JSAs where this person is a crew member today — scoped by company
      let todayQuery = "SELECT * FROM jsa_records WHERE date = $1 AND status != 'rejected' AND status != 'draft'";
      const todayParams = [today];
      if (req.companyId) { todayParams.push(req.companyId); todayQuery += ` AND company_id = $${todayParams.length}`; }
      todayQuery += ' ORDER BY created_at DESC';
      const allToday = (await (req.db || DB).db.query(todayQuery, todayParams)).rows;
      const shared = allToday.filter(j => {
        if (j.person_id === personId) return false; // already in own
        try {
          const crew = JSON.parse(j.crew_members || '[]');
          return crew.some(c => c.id === personId || c.person_id === personId);
        } catch { return false; }
      });

      const jsas = [...own, ...shared].map(j => ({
        id: j.id,
        jsa_number: j.jsa_number,
        status: j.status,
        person_name: j.person_name,
        form_data: JSON.parse(j.form_data || '{}'),
        task_id: j.task_id,
        created_at: j.created_at,
      }));

      res.json(jsas);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================
  // Safety Dashboard — JSA compliance overview
  // ============================================

  router.get('/dashboard', requireAuth, async (req, res) => {
    try {
      const date = req.query.date || new Date().toISOString().split('T')[0];
      const trade = req.query.trade;

      const DB = require('../../database/db');

      // Get all active people (filtered by company and optionally by trade)
      let people;
      const companyId = req.companyId;
      if (trade && companyId) {
        people = (await (req.db || DB).db.query("SELECT id, name, role_title, trade FROM people WHERE status = 'active' AND trade = $1 AND company_id = $2", [trade, companyId])).rows;
      } else if (trade) {
        people = (await (req.db || DB).db.query("SELECT id, name, role_title, trade FROM people WHERE status = 'active' AND trade = $1", [trade])).rows;
      } else if (companyId) {
        people = (await (req.db || DB).db.query("SELECT id, name, role_title, trade FROM people WHERE status = 'active' AND company_id = $1", [companyId])).rows;
      } else {
        people = (await (req.db || DB).db.query("SELECT id, name, role_title, trade FROM people WHERE status = 'active'")).rows;
      }

      // Get all JSAs for this date — scoped by company
      let dashJsaQuery = "SELECT * FROM jsa_records WHERE date = $1 AND status != 'rejected'";
      const dashJsaParams = [date];
      if (companyId) { dashJsaParams.push(companyId); dashJsaQuery += ` AND company_id = $${dashJsaParams.length}`; }
      const allJsas = (await (req.db || DB).db.query(dashJsaQuery, dashJsaParams)).rows;

      const completed = [];
      const missing = [];
      const mismatched = [];

      for (const person of people) {
        const personJsas = allJsas.filter(j => {
          if (j.person_id === person.id) return true;
          try {
            const crew = JSON.parse(j.crew_members || '[]');
            return crew.some(c => c.id === person.id || c.person_id === person.id);
          } catch { return false; }
        });

        if (personJsas.length === 0) {
          missing.push({ person });
        } else {
          const jsa = personJsas[0];
          let formData; try { formData = JSON.parse(jsa.form_data || '{}'); } catch { formData = {}; }
          completed.push({
            person,
            jsa: { id: jsa.id, jsa_number: jsa.jsa_number, status: jsa.status, task_description: formData.task_description },
          });
        }
      }

      res.json({
        date,
        trade: trade || 'all',
        total: people.length,
        completed: completed.length,
        missing: missing.length,
        people_completed: completed,
        people_missing: missing,
        people_mismatched: mismatched,
      });
    } catch (err) {
      console.error('Dashboard error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
