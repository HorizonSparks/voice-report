/**
 * Error Tracking Module — GlitchTip (Sentry-compatible)
 * Captures application errors and sends them to GlitchTip for monitoring.
 * Uses @sentry/node SDK which is fully compatible with GlitchTip.
 */
const Sentry = require('@sentry/node');

const DSN = process.env.SENTRY_DSN_BACKEND || '';
const ENVIRONMENT = process.env.NODE_ENV || 'production';

/**
 * Initialize Sentry/GlitchTip error tracking.
 * Must be called before any other middleware.
 */
function initialize() {
  if (!DSN) {
    console.log('[ErrorTracking] No SENTRY_DSN_BACKEND configured — error tracking disabled');
    return;
  }

  Sentry.init({
    dsn: DSN,
    environment: ENVIRONMENT,
    release: 'voice-report@2.0.0',
    tracesSampleRate: 0.1,
    beforeSend(event) {
      // Scrub sensitive data
      if (event.request) {
        delete event.request.cookies;
        if (event.request.headers) {
          delete event.request.headers.cookie;
          delete event.request.headers.authorization;
          delete event.request.headers['x-api-key'];
        }
      }
      return event;
    },
  });

  console.log('[ErrorTracking] GlitchTip initialized');
}

/**
 * Capture an error with optional context.
 * Use this in catch blocks across all route files.
 */
function captureError(err, context = {}) {
  if (!DSN) return;

  Sentry.withScope((scope) => {
    if (context.correlationId) scope.setTag('correlationId', context.correlationId);
    if (context.route) scope.setTag('route', context.route);
    if (context.personId) scope.setUser({ id: context.personId });
    if (context.extra) scope.setExtras(context.extra);
    Sentry.captureException(err);
  });
}

/**
 * Express error-handling middleware.
 * Place AFTER all route mounts: app.use(errorTracking.errorHandler)
 */
function errorHandler(err, req, res, next) {
  captureError(err, {
    correlationId: req.correlationId,
    route: req.route?.path || req.path,
    personId: req.auth?.person_id,
  });

  // Don't override response if headers already sent
  if (res.headersSent) return next(err);

  console.error(`[${req.correlationId || 'no-id'}] Unhandled error:`, err.message);
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = {
  initialize,
  captureError,
  errorHandler,
};
