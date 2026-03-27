import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import '../styles.css';
import './i18n/i18n.js';

// Global fetch override — always send session cookie with API requests
const originalFetch = window.fetch.bind(window);
window.fetch = (url, options = {}) => {
  // Only add credentials for same-origin /api/ calls
  if (typeof url === 'string' && url.startsWith('/api')) {
    options = { ...options, credentials: 'include' };
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
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
