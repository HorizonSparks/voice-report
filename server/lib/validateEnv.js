'use strict';

// Boot-time environment-variable validation.
// Required envs MUST be present before app starts; missing ones cause non-zero exit
// instead of silent degradation. Run this BEFORE any module that reads these envs
// (in particular database/db.js, which used to fall back to hardcoded credentials).

const REQUIRED = [
  // Database
  'PG_HOST', 'PG_PORT', 'PG_DATABASE', 'PG_USER', 'PG_PASSWORD',
  // Auth
  'ADMIN_PIN',
  'INTEGRATION_KEY_SUPPORT',
  // AI providers
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY',
  // Keycloak shared-auth (required for JWT verification on cross-app routes)
  'KEYCLOAK_ISSUER', 'KEYCLOAK_AUDIENCE', 'KEYCLOAK_OIDC_CLIENT_ID',
];

const RECOMMENDED = [
  'SENTRY_DSN_BACKEND',
  'GRAFANA_URL',
  // SSO redirect routes (/auth/sso/*) return 503 until this is set in .env
  'KEYCLOAK_OIDC_CLIENT_SECRET',
  // Set to .horizonsparks.ai once DNS unifies under the same apex
  'COOKIE_DOMAIN',
];

function validateEnv() {
  const missing = REQUIRED.filter((k) => !process.env[k] || String(process.env[k]).trim() === '');
  const missingRecommended = RECOMMENDED.filter((k) => !process.env[k]);

  if (missing.length > 0) {
    console.error('');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('FATAL: missing required environment variables:');
    for (const k of missing) console.error('  - ' + k);
    console.error('');
    console.error('Set these in .env (or your container environment) and restart.');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('');
    process.exit(1);
  }

  if (missingRecommended.length > 0) {
    console.warn('[env] Recommended (not required) env vars missing: ' + missingRecommended.join(', '));
  }
}

module.exports = { validateEnv, REQUIRED, RECOMMENDED };
