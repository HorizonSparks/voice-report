'use strict';

/**
 * Centralized rate limiters. Mount on individual routes — keeps the policy
 * surface in one place and avoids drift between similar endpoints.
 *
 * Key generation: when the request is authenticated, key by person_id so a
 * single user can't flood across multiple IPs. When unauthenticated (login,
 * webauthn challenge), key by IP. Integration callers (PIDS-app proxy) get
 * keyed by the customer's as_person_id when present, otherwise IP — same
 * isolation pattern as sendRateLimiter in routes/support.js.
 */

const rateLimit = require('express-rate-limit');

function authedOrIpKey(req) {
  if (req.auth && req.auth.isIntegration) {
    return (req.body && req.body.as_person_id) || (req.query && req.query.as_person_id) || req.ip;
  }
  return (req.auth && req.auth.person_id) || req.ip;
}

// Login: 5 FAILED attempts per 5 minutes per IP. Tight — PIN auth has only
// 10,000 combinations on a 4-digit space, so brute force is otherwise
// trivial. Successful logins don't count toward the limit, so a legitimate
// user typing the wrong PIN once or twice isn't penalized after they get
// it right. Keyed by IP because the request is pre-auth.
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  skipSuccessfulRequests: true,
  message: { error: 'Too many failed login attempts. Try again in 5 minutes.' },
});

// AI-heavy endpoints: 60 requests/min per user. Generous for normal use but
// caps runaway agents and stops a single user from blowing up Claude spend.
const aiHeavyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: authedOrIpKey,
  message: { error: 'Too many AI requests — please wait a moment.' },
});

// File uploads: 30/min per user. Protects disk + memory; multer parses
// before the route handler runs.
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: authedOrIpKey,
  message: { error: 'Too many uploads — please wait a moment.' },
});

// WebAuthn ceremonies: 20/min per IP. Each ceremony involves cryptographic
// state; bursts are abnormal and usually scripted.
const webauthnLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { error: 'Too many WebAuthn attempts.' },
});

module.exports = {
  authedOrIpKey,
  loginLimiter,
  aiHeavyLimiter,
  uploadLimiter,
  webauthnLimiter,
};
