/**
 * Push notification endpoints.
 *
 *   GET  /api/push/public-key   — VAPID public key for the client
 *                                 to call PushManager.subscribe()
 *   POST /api/push/subscribe    — register a PushSubscription
 *   POST /api/push/unsubscribe  — drop a subscription by endpoint
 *   POST /api/push/test         — send a self-push for end-to-end verification
 *
 * All non-public-key routes require auth. Permission to push *to other
 * people* is a separate concern enforced where push.sendToPerson() is
 * actually called (messaging routes, safety alerts) — these routes
 * only manage the caller's own subscriptions.
 */
const { Router } = require('express');
const { requireAuth } = require('../middleware/sessionAuth');
const push = require('../services/push');

const router = Router();

router.get('/public-key', (req, res) => {
  const key = push.getPublicKey();
  if (!key) return res.status(503).json({ error: 'Push notifications not configured' });
  res.json({ publicKey: key });
});

router.post('/subscribe', requireAuth, async (req, res) => {
  try {
    if (!push.isConfigured()) {
      return res.status(503).json({ error: 'Push notifications not configured' });
    }
    const personId = req.auth?.person_id;
    if (!personId) return res.status(401).json({ error: 'Authenticated person required' });
    const { subscription } = req.body || {};
    await push.saveSubscription({
      personId,
      subscription,
      userAgent: req.get('user-agent'),
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[push] subscribe failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.post('/unsubscribe', requireAuth, async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
    await push.removeSubscription(endpoint);
    res.json({ success: true });
  } catch (err) {
    console.error('[push] unsubscribe failed:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

router.post('/test', requireAuth, async (req, res) => {
  try {
    const personId = req.auth?.person_id;
    if (!personId) return res.status(401).json({ error: 'Authenticated person required' });
    const result = await push.sendToPerson(personId, {
      title: 'Horizon Sparks',
      body: 'Notificaciones funcionando correctamente.',
      url: '/',
      tag: 'push-test',
    });
    res.json(result);
  } catch (err) {
    console.error('[push] test failed:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
