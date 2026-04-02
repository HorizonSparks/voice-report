/**
 * Frontend Error Tracking — GlitchTip (Sentry-compatible)
 * Initializes @sentry/react and provides error capture utilities.
 */
import * as Sentry from '@sentry/react';

const DSN = import.meta.env.VITE_SENTRY_DSN || '';

/**
 * Initialize Sentry/GlitchTip for the React frontend.
 * Call once at app startup, before rendering.
 */
export function initErrorTracking() {
  if (!DSN) {
    console.log('[ErrorTracking] No VITE_SENTRY_DSN configured — frontend error tracking disabled');
    return;
  }

  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.MODE || 'production',
    release: 'voice-report-frontend@2.0.0',
    tracesSampleRate: 0.1,
    integrations: [
      Sentry.browserTracingIntegration(),
    ],
  });

  console.log('[ErrorTracking] GlitchTip frontend initialized');
}

/**
 * Set the current user context for error reports.
 * Call after login.
 */
export function setErrorUser(user) {
  if (!DSN) return;
  Sentry.setUser({
    id: user?.person_id || user?.id,
    username: user?.name,
    email: user?.email,
  });
}

/**
 * Capture an error with optional context.
 */
export function captureError(err, context = {}) {
  if (!DSN) return;
  Sentry.withScope((scope) => {
    if (context.component) scope.setTag('component', context.component);
    if (context.action) scope.setTag('action', context.action);
    if (context.extra) scope.setExtras(context.extra);
    Sentry.captureException(err);
  });
}

// Re-export ErrorBoundary for wrapping components
export const ErrorBoundary = Sentry.ErrorBoundary;
