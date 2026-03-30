import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider, CssBaseline } from '@mui/material';
import theme from './theme.js';
import App from './App.jsx';
import '../styles.css';
import './i18n/i18n.js';

// Global fetch override — always send session cookie with API requests
const originalFetch = window.fetch.bind(window);
window.fetch = (url, options = {}) => {
  // Only add credentials for same-origin /api/ calls
  if (typeof url === 'string' && url.startsWith('/api')) {
    options = { ...options, credentials: 'include' };
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

// Register service worker in production — with update detection
if ('serviceWorker' in navigator && window.location.hostname !== 'localhost') {
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
