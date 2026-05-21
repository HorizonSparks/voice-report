/**
 * Offline request queue — IndexedDB-backed outbox for POSTs that failed
 * to reach the server due to lost connectivity.
 *
 * Why this exists: this is a field-worker app. Construction sites have
 * spotty signal. Without persistence, a JSON POST that fails on a flaky
 * network is silently lost between the optimistic UI update and the
 * page reload.
 *
 * Scope (intentionally narrow):
 *   - JSON POSTs only. Multipart / binary uploads (audio, photos) are
 *     not queued — they tend to require AI services that need online
 *     anyway, and Blob persistence in IndexedDB across reloads has
 *     subtle gotchas.
 *   - The caller opts in per request via apiClient's `queueOnOffline`.
 *   - We retry but do not reorder. FIFO drain on reconnect.
 *
 * Storage layout:
 *   DB:    voicereport-offline
 *   Store: outbox (autoIncrement key)
 *   Item:  { path, method, body, headers, createdAt, attempts, lastError }
 */

const DB_NAME = 'voicereport-offline';
const STORE = 'outbox';
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode) {
  return openDb().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

export async function enqueue({ path, method = 'POST', body, headers }) {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const item = {
      path,
      method,
      body,
      headers: headers || null,
      createdAt: new Date().toISOString(),
      attempts: 0,
      lastError: null,
    };
    const req = store.add(item);
    req.onsuccess = () => {
      notifyListeners();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function count() {
  const store = await tx('readonly');
  return new Promise((resolve, reject) => {
    const req = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAll() {
  const store = await tx('readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function remove(id) {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function update(id, patch) {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const item = getReq.result;
      if (!item) return resolve();
      Object.assign(item, patch);
      const putReq = store.put(item);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

let draining = false;

/**
 * Walk the queue in insertion order. On network failure for an item,
 * bump attempts and stop — preserves order, retries the same item next
 * pass. On HTTP response (any status), remove the item — server has
 * acknowledged it, success/failure becomes a server-side concern.
 */
export async function drain() {
  if (draining) return { drained: 0, remaining: await count() };
  draining = true;
  let drained = 0;
  try {
    const items = await getAll();
    for (const item of items) {
      let response;
      try {
        response = await fetch(item.path, {
          method: item.method,
          headers: { 'Content-Type': 'application/json', ...(item.headers || {}) },
          credentials: 'include',
          body: JSON.stringify(item.body),
        });
      } catch (err) {
        await update(item.id, {
          attempts: (item.attempts || 0) + 1,
          lastError: String(err && err.message || err),
        });
        break;
      }
      await remove(item.id);
      drained++;
      if (!response.ok) {
        console.warn('[offlineQueue] server rejected queued request', {
          path: item.path,
          status: response.status,
        });
      }
    }
  } finally {
    draining = false;
    notifyListeners();
  }
  return { drained, remaining: await count() };
}

const listeners = new Set();
function notifyListeners() {
  count().then((n) => {
    listeners.forEach((cb) => {
      try { cb(n); } catch {}
    });
  });
}

export function subscribe(cb) {
  listeners.add(cb);
  count().then(cb).catch(() => cb(0));
  return () => listeners.delete(cb);
}

let installed = false;
export function installAutoDrain() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('online', () => { drain(); });
  if (navigator.onLine) drain();
  setInterval(() => {
    if (navigator.onLine) {
      count().then((n) => { if (n > 0) drain(); });
    }
  }, 60_000);
}
