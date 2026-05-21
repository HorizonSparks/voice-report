/**
 * Centralized API client.
 *
 * What this gives us that raw `fetch` doesn't:
 *   - One place to set `credentials: 'include'` so session cookies always
 *     ride along (was missing on some calls before).
 *   - Auto JSON serialization + parsing.
 *   - A typed `ApiError` so UI code can branch on status without
 *     re-parsing response.json() in every catch block.
 *   - Built-in offline outbox integration: if a JSON POST fails because
 *     the device is offline (or the fetch throws a TypeError), and the
 *     caller passes `queueOnOffline: true`, the request lands in
 *     IndexedDB and replays when connectivity returns. The call resolves
 *     with `{ queued: true }` so optimistic UI can proceed.
 *
 * Not in scope: GETs are not retried, multipart uploads (audio/photos)
 * are not queued. See [[offlineQueue]] for the why.
 *
 * Migration policy: NEW code and any view being touched should adopt
 * apiClient. We are deliberately not migrating the existing ~190 fetch
 * call sites in one pass — that would be a high-risk no-feature PR.
 */

import { enqueue } from './offlineQueue.js';

export class ApiError extends Error {
  constructor(message, { status, body, queued = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.queued = queued;
  }
}

function isNetworkError(err) {
  // fetch() rejects with TypeError on network failure (DNS, dropped
  // connection, CORS preflight failure, offline). HTTP error responses
  // do NOT reject — they resolve with response.ok === false. So this
  // check is enough to distinguish "couldn't reach server" from
  // "server said no".
  return err instanceof TypeError;
}

async function parseBody(response) {
  const ct = response.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try { return await response.json(); } catch { return null; }
  }
  try { return await response.text(); } catch { return null; }
}

/**
 * Core fetch wrapper. Most code should use the apiGet/apiPost/apiPostForm
 * helpers below; reach for this only when you need fine control.
 *
 * @param {string} path - URL or path (e.g. '/api/reports')
 * @param {object} [options]
 * @param {string} [options.method='GET']
 * @param {*}      [options.body]            JSON body (auto-stringified)
 * @param {FormData} [options.formData]      Multipart body — overrides body
 * @param {object} [options.headers]         Extra headers
 * @param {AbortSignal} [options.signal]
 * @param {boolean} [options.queueOnOffline] Enqueue JSON POSTs that fail
 *                                           with a network error
 * @returns {Promise<*>} parsed response body, or `{ queued: true }`
 *                      if the request was placed in the offline outbox
 * @throws {ApiError} on HTTP error responses (4xx/5xx) or network
 *                    failures when queueOnOffline is false/inapplicable
 */
export async function apiFetch(path, options = {}) {
  const {
    method = 'GET',
    body,
    formData,
    headers = {},
    signal,
    queueOnOffline = false,
  } = options;

  const init = { method, credentials: 'include', signal, headers: { ...headers } };
  if (formData) {
    init.body = formData;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = init.headers['Content-Type'] || 'application/json';
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, init);
  } catch (err) {
    if (
      queueOnOffline
      && isNetworkError(err)
      && method !== 'GET'
      && !formData
    ) {
      await enqueue({ path, method, body, headers });
      return { queued: true };
    }
    throw new ApiError(err.message || 'Network error', { status: 0 });
  }

  const parsed = await parseBody(response);
  if (!response.ok) {
    const message = (parsed && typeof parsed === 'object' && parsed.error)
      ? parsed.error
      : `HTTP ${response.status}`;
    throw new ApiError(message, { status: response.status, body: parsed });
  }
  return parsed;
}

export function apiGet(path, options = {}) {
  return apiFetch(path, { ...options, method: 'GET' });
}

export function apiPost(path, body, options = {}) {
  return apiFetch(path, { ...options, method: 'POST', body });
}

export function apiPostForm(path, formData, options = {}) {
  return apiFetch(path, { ...options, method: 'POST', formData });
}

export function apiPatch(path, body, options = {}) {
  return apiFetch(path, { ...options, method: 'PATCH', body });
}

export function apiPut(path, body, options = {}) {
  return apiFetch(path, { ...options, method: 'PUT', body });
}

export function apiDelete(path, options = {}) {
  return apiFetch(path, { ...options, method: 'DELETE' });
}
