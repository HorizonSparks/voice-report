/**
 * API fetch wrapper — ensures session cookie is always sent.
 * Drop-in replacement for fetch() when calling /api/* endpoints.
 */
export function apiFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    credentials: 'include', // Always send hs_session cookie
    headers: {
      ...options.headers,
      // Only set Content-Type for JSON if not sending FormData
      ...(options.body && !(options.body instanceof FormData) && !options.headers?.['Content-Type']
        ? { 'Content-Type': 'application/json' }
        : {}),
    },
  });
}

export default apiFetch;
