/**
 * Structured Logger — Pino + Loki
 * JSON logging to stdout. Promtail picks it up and ships to Loki.
 * Every log includes correlationId for end-to-end request tracing.
 */
const pino = require('pino');

// Base logger instance
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'voice-report' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

// Child loggers for subsystems
const agentLogger = logger.child({ subsystem: 'agent' });
const aiLogger = logger.child({ subsystem: 'ai' });
const dbLogger = logger.child({ subsystem: 'db' });

/**
 * Express request logger middleware.
 * Logs every HTTP request with method, path, status, duration, and correlationId.
 */
function requestLogger(req, res, next) {
  const start = Date.now();

  const onFinish = () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[level]({
      msg: 'http_request',
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      duration_ms: duration,
      correlationId: req.correlationId || null,
      personId: req.auth?.person_id || null,
    });

    res.removeListener('finish', onFinish);
  };

  res.on('finish', onFinish);
  next();
}

module.exports = {
  logger,
  agentLogger,
  aiLogger,
  dbLogger,
  requestLogger,
};
