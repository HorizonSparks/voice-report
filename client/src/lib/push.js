/**
 * Browser-side push subscription helper.
 *
 * The flow is two-step on purpose: the user must click a button (or
 * accept a prompt) that triggers Notification.requestPermission().
 * Browsers reject permission requests that aren't tied to a user
 * gesture, so we never auto-prompt on mount.
 *
 * Idempotent: calling enablePush() when already subscribed just
 * refreshes the server-side record. Calling disablePush() when not
 * subscribed is a no-op.
 */

import { apiGet, apiPost } from './apiClient.js';

function isSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

// VAPID public key arrives as URL-safe base64; PushManager needs Uint8Array.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getRegistration() {
  // The app's SW is registered by client/src/main.jsx — we wait for
  // `ready` instead of re-registering to avoid double-binding.
  //
  // Hard timeout so a misregistered or evicted SW doesn't hang the
  // subscribe flow forever. 5 s is generous; healthy registration
  // resolves in <100 ms.
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('Service worker not ready (timeout)')),
      5000,
    )),
  ]);
}

export function getPushState() {
  if (!isSupported()) return { supported: false, permission: 'unsupported' };
  return { supported: true, permission: Notification.permission };
}

export async function isSubscribed() {
  if (!isSupported()) return false;
  const reg = await getRegistration();
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}

/**
 * Ask permission (if not already granted), subscribe with VAPID, and
 * register the subscription with the server. Returns { ok, reason? }
 * so callers can show appropriate UI without re-checking permission.
 */
export async function enablePush() {
  if (!isSupported()) return { ok: false, reason: 'unsupported' };

  if (Notification.permission === 'denied') {
    return { ok: false, reason: 'denied' };
  }

  // requestPermission() resolves with the new permission state. On
  // already-granted, it short-circuits and returns 'granted'.
  if (Notification.permission !== 'granted') {
    const result = await Notification.requestPermission();
    if (result !== 'granted') return { ok: false, reason: result };
  }

  let publicKey;
  try {
    const r = await apiGet('/api/push/public-key');
    publicKey = r.publicKey;
  } catch (err) {
    // 404 = server doesn't have /api/push/* mounted (likely needs restart
    // because the route was added after node started). 503 = VAPID keys
    // missing. From a user-facing perspective both surface the same fix:
    // "server isn't configured for push yet — wait for an admin."
    return { ok: false, reason: 'not_configured' };
  }
  if (!publicKey) return { ok: false, reason: 'not_configured' };

  const reg = await getRegistration();
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  await apiPost('/api/push/subscribe', { subscription: subscription.toJSON() });
  return { ok: true };
}

export async function disablePush() {
  if (!isSupported()) return { ok: true };
  const reg = await getRegistration();
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return { ok: true };
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  try { await apiPost('/api/push/unsubscribe', { endpoint }); } catch {}
  return { ok: true };
}
