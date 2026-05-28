/**
 * PPE Requests
 *
 * Workers (any authed user) request safety equipment;
 * Sparks support (or anyone with sparks_role >= advisor) sees the queue
 * and marks requests fulfilled.
 *
 * Backed by voicereport.ppe_requests (already created in a prior migration).
 *
 * Status lifecycle: open -> fulfilled  (a 'cancelled' value is also accepted
 * for the worker to back out before fulfillment, but no UI surfaces it yet).
 */
const { Router } = require('express');
const DB = require('../../database/db');
const { requireAuth, requireSparksRole } = require('../middleware/sessionAuth');

const router = Router();

// POST /api/ppe — create a new request (any authed user)
router.post('/', requireAuth, async (req, res) => {
  try {
    const { items, notes } = req.body || {};
    if (!items || !String(items).trim()) {
      return res.status(400).json({ error: 'items required' });
    }
    const requester_id   = req.auth.person_id;
    const requester_name = req.auth.person_name || null;
    const id = 'ppe_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

    await DB.db.query(
      `INSERT INTO ppe_requests (id, requester_id, requester_name, items, notes, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'open', NOW())`,
      [id, requester_id, requester_name, String(items), notes || null]
    );
    res.json({ success: true, id });
  } catch (err) {
    console.error('PPE create error:', err);
    res.status(500).json({ error: 'Failed to create PPE request' });
  }
});

// GET /api/ppe/mine — current user's own requests, newest first
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const { rows } = await DB.db.query(
      'SELECT id, items, notes, status, created_at, resolved_at FROM ppe_requests WHERE requester_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.auth.person_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('PPE mine error:', err);
    res.status(500).json({ error: 'Failed to load PPE requests' });
  }
});

// GET /api/ppe — all open requests (Sparks operator queue, advisor+).
//   ?status=open|fulfilled|all (default: open)
router.get('/', requireAuth, requireSparksRole('advisor'), async (req, res) => {
  try {
    const status = req.query.status || 'open';
    const where  = (status === 'all') ? '' : 'WHERE status = $1';
    const params = (status === 'all') ? []  : [status];
    const { rows } = await DB.db.query(
      `SELECT id, requester_id, requester_name, assigned_to, items, notes, status, created_at, resolved_at
         FROM ppe_requests
         ${where}
         ORDER BY created_at DESC
         LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('PPE list error:', err);
    res.status(500).json({ error: 'Failed to load PPE requests' });
  }
});

// POST /api/ppe/:id/fulfill — mark resolved (Sparks support+)
router.post('/:id/fulfill', requireAuth, requireSparksRole('support'), async (req, res) => {
  try {
    const assignee = req.auth.person_id;
    const result = await DB.db.query(
      "UPDATE ppe_requests SET status = 'fulfilled', assigned_to = $1, resolved_at = NOW()::text WHERE id = $2 AND status = 'open' RETURNING id",
      [assignee, req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'PPE request not found or already fulfilled' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('PPE fulfill error:', err);
    res.status(500).json({ error: 'Failed to fulfill PPE request' });
  }
});

module.exports = router;
