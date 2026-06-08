import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider, CssBaseline } from '@mui/material';
import theme from './theme.js';
import App from './App.jsx';
import '../styles.css';
import './i18n/i18n.js';

// Single-domain unify: the shared Keycloak access token (set by the one login — the
// LoopFolders/Keycloak form, picture 2) lives in localStorage on this same origin. Return it
// ONLY if still valid, so a stale token can never shadow a working cookie session. This is what
// lets ONE login light up Voice Report too — VR's backend already validates Keycloak JWTs.
function _kcAccessToken() {
  try {
    const t = localStorage.getItem('accessToken');
    if (!t) return null;
    const payload = JSON.parse(atob(t.split('.')[1]));
    if (payload && payload.exp && payload.exp * 1000 > Date.now() + 5000) return t;
    return null;
  } catch (e) { return null; }
}

// Global fetch override — always send session cookie with API requests, and attach the
// shared Keycloak Bearer when present (cookie session stays the fallback).
const originalFetch = window.fetch.bind(window);
window.fetch = (url, options = {}) => {
  // Only add credentials for same-origin /api/ calls
  if (typeof url === 'string' && url.startsWith('/api')) {
    options = { ...options, credentials: 'include' };
    const kc = _kcAccessToken();
    if (kc) {
      const h = { ...(options.headers || {}) };
      const hasAuth = Object.keys(h).some((k) => k.toLowerCase() === 'authorization');
      if (!hasAuth) { h.Authorization = 'Bearer ' + kc; options.headers = h; }
    }
    // Inject company_id when simulating a company (Sparks admin viewing as a company)
    if (window.__simulatingCompanyId && !url.includes('company_id=')) {
      const sep = url.includes('?') ? '&' : '?';
      url = url + sep + 'company_id=' + encodeURIComponent(window.__simulatingCompanyId);
    }
  }
  return originalFetch(url, options);
};

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <h2>Something went wrong</h2>
          <p style={{ color: 'var(--charcoal)' }}>{String(this.state.error?.message || this.state.error || 'Unknown error')}</p>
          <button
            onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
            style={{ padding: '12px 24px', background: '#F99440', color: 'white', border: 'none', borderRadius: 8, fontSize: 16, marginTop: 16, cursor: 'pointer' }}
          >
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </ThemeProvider>
);

// Register service worker. Previously skipped on localhost to avoid HMR
// conflicts, but the SW we ship goes network-first for /api/ and
// cache: 'no-store' for .js/.css — Vite HMR is unaffected. Registering
// in dev is required for web push (PushManager.subscribe() needs a
// registered SW) and for testing offline behavior end-to-end.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => {
        console.log('SW registered:', reg.scope);

        // Check for updates every 5 minutes
        setInterval(() => {
          reg.update().catch(() => {});
        }, 5 * 60 * 1000);

        // When a new SW is found waiting
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New version installed but waiting — notify the app
                window.dispatchEvent(new CustomEvent('sw-update-available'));
              }
            });
          }
        });
      })
      .catch(err => console.log('SW registration failed:', err));

    // Listen for SW_UPDATED message from the service worker
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'SW_UPDATED') {
        window.dispatchEvent(new CustomEvent('sw-update-available'));
      }
    });
  });
}
