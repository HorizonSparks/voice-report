/**
 * Web Push service — fan-out delivery to a person's registered devices.
 *
 * Subscriptions live in voicereport.push_subscriptions. One person can
 * have many active subscriptions (work tablet, phone, office desktop);
 * we push to all of them in parallel and prune any that the push
 * provider reports as gone (HTTP 410 or 404).
 *
 * Safety: every call is best-effort. A failed push is logged and
 * discarded — it must NEVER block the originating action (sending a
 * message, posting a safety alert). Push is a courtesy, not a contract.
 *
 * Configuration: requires VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and
 * VAPID_CONTACT environment variables. Without them this module
 * silently no-ops so the app keeps working in dev/test environments
 * that don't have keys provisioned.
 */
const webpush = require('web-push');
const DB = require('../../database/db');

let configured = false;
if (
  process.env.VAPID_PUBLIC_KEY
  && process.env.VAPID_PRIVATE_KEY
  && process.env.VAPID_CONTACT
) {
  webpush.setVapidDetails(
    process.env.VAPID_CONTACT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  configured = true;
} else {
  console.warn('[push] VAPID keys not configured — push notifications disabled');
}

function isConfigured() { return configured; }

function getPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

/**
 * Save (or refresh) a subscription returned by the browser's PushManager.
 * Endpoint is the unique key — same browser/device re-subscribing produces
 * the same endpoint, so an UPSERT keeps things tidy without dedup logic
 * in the route handler.
 */
async function saveSubscription({ personId, subscription, userAgent }) {
  if (!personId || !subscription || !subscription.endpoint) {
    throw new Error('personId and subscription.endpoint are required');
  }
  const { endpoint, keys = {} } = subscription;
  if (!keys.p256dh || !keys.auth) {
    throw new Error('subscription.keys.p256dh and .auth are required');
  }
  await DB.db.query(
    `INSERT INTO voicereport.push_subscriptions
       (person_id, endpoint, p256dh, auth, user_agent, last_used_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (endpoint) DO UPDATE
       SET person_id = EXCLUDED.person_id,
           p256dh = EXCLUDED.p256dh,
           auth = EXCLUDED.auth,
           user_agent = EXCLUDED.user_agent,
           last_used_at = NOW()`,
    [personId, endpoint, keys.p256dh, keys.auth, userAgent || null],
  );
}

async function removeSubscription(endpoint) {
  if (!endpoint) return;
  await DB.db.query(
    'DELETE FROM voicereport.push_subscriptions WHERE endpoint = $1',
    [endpoint],
  );
}

/**
 * Send a notification to every device a person is subscribed on.
 *
 * Payload shape (what the SW receives):
 *   { title, body, url?, tag?, icon? }
 *
 * `url` is the path the SW navigates to on click. `tag` collapses
 * duplicate notifications (e.g. spamming the same message twice only
 * shows one). Both optional.
 */
async function sendToPerson(personId, payload) {
  if (!configured) return { sent: 0, removed: 0, skipped: 'not_configured' };
  if (!personId || !payload) return { sent: 0, removed: 0 };

  const { rows } = await DB.db.query(
    `SELECT id, endpoint, p256dh, auth
       FROM voicereport.push_subscriptions
      WHERE person_id = $1`,
    [personId],
  );
  if (rows.length === 0) return { sent: 0, removed: 0 };

  const json = JSON.stringify(payload);
  const results = await Promise.allSettled(rows.map((row) => webpush.sendNotification(
    { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
    json,
  )));

  let sent = 0;
  let removed = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      sent++;
      continue;
    }
    const err = r.reason || {};
    // 410 Gone / 404 Not Found = the user unsubscribed in the browser.
    // Push provider is telling us to forget this endpoint. Anything else
    // (network blip, transient 5xx) we leave alone and retry next push.
    if (err.statusCode === 410 || err.statusCode === 404) {
      try {
        await removeSubscription(rows[i].endpoint);
        removed++;
      } catch (e) {
        console.warn('[push] failed to prune dead subscription:', e.message);
      }
    } else {
      console.warn('[push] delivery failed:', err.statusCode || '?', err.body || err.message);
    }
  }

  // Best-effort touch so we can later trim subscriptions that haven't
  // been used in months (e.g. retired tablets).
  DB.db.query(
    'UPDATE voicereport.push_subscriptions SET last_used_at = NOW() WHERE person_id = $1',
    [personId],
  ).catch(() => {});

  return { sent, removed };
}

module.exports = {
  isConfigured,
  getPublicKey,
  saveSubscription,
  removeSubscription,
  sendToPerson,
};
