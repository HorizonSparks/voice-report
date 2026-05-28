/**
 * Stripe Client Wrapper (server/services/stripe/client.js)
 *
 * Lazy-initialized Stripe SDK. The server boots fine without STRIPE_API_KEY
 * (and billing routes return 503 instead of crashing). When the key is set,
 * the same SDK instance is reused for the process lifetime.
 *
 * Created 2026-05-15 for Phase A of the Stripe billing integration.
 *
 * Exports:
 *   - getStripe()                                      → SDK instance or throws
 *   - isStripeConfigured()                             → boolean
 *   - reportMeterEvent({eventName, customerId, value, identifier})
 *   - getOrCreateCustomer({companyId, name, email})    → Stripe customer object
 *   - constructWebhookEvent(rawBody, signature)        → parsed event or throws
 *
 * Why a wrapper instead of `require('stripe')` everywhere:
 *   - Single place for API version pinning
 *   - Single place to swap test↔live keys
 *   - Easy to mock in tests
 *   - Lazy init means the server can run without billing in dev
 */

const STRIPE_API_VERSION = '2024-12-18.acacia';

let _stripe = null;
let _initAttempted = false;

function getStripe() {
  if (_stripe) return _stripe;
  if (!_initAttempted) {
    _initAttempted = true;
    const key = process.env.STRIPE_API_KEY;
    if (!key) return null;
    const Stripe = require('stripe');
    _stripe = new Stripe(key, {
      apiVersion: STRIPE_API_VERSION,
      typescript: false,
      // Built-in retry on network failures + 5xx + 429
      maxNetworkRetries: 2,
      timeout: 15000,
    });
  }
  return _stripe;
}

function isStripeConfigured() {
  return !!process.env.STRIPE_API_KEY;
}

/**
 * Report a single meter event to Stripe.
 *
 * @param {object} params
 * @param {string} params.eventName    - e.g. 'sparks_ai_opus_input' (matches meter.event_name)
 * @param {string} params.customerId   - Stripe customer ID (cus_*)
 * @param {number} params.value        - usage value (e.g. token count). Will be sent as a string per Stripe API.
 * @param {string} params.identifier   - dedupe key. Same identifier = idempotent (Stripe rejects duplicates).
 * @param {Date}   [params.timestamp]  - optional event time (defaults to now)
 * @returns {Promise<object>} - Stripe meter event object
 */
async function reportMeterEvent({ eventName, customerId, value, identifier, timestamp }) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe not configured (STRIPE_API_KEY missing)');
  if (!eventName) throw new Error('reportMeterEvent: eventName required');
  if (!customerId) throw new Error('reportMeterEvent: customerId required');
  if (value == null) throw new Error('reportMeterEvent: value required');
  if (!identifier) throw new Error('reportMeterEvent: identifier required (for idempotency)');

  const payload = {
    event_name: eventName,
    identifier,
    payload: {
      stripe_customer_id: customerId,
      value: String(value),
    },
  };
  if (timestamp) payload.timestamp = Math.floor(timestamp.getTime() / 1000);

  return await stripe.billing.meterEvents.create(payload);
}

/**
 * Find existing Stripe customer by metadata.company_id, or create one.
 * Used when a company is first billed.
 *
 * @param {object} params
 * @param {string} params.companyId    - our internal company UUID
 * @param {string} params.name         - company display name
 * @param {string} [params.email]      - AP contact email
 * @returns {Promise<object>}          - Stripe customer object
 */
async function getOrCreateCustomer({ companyId, name, email }) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe not configured');
  if (!companyId) throw new Error('getOrCreateCustomer: companyId required');

  // Search by metadata first (idempotent lookup)
  const existing = await stripe.customers.search({
    query: `metadata['company_id']:'${companyId}'`,
    limit: 1,
  });
  if (existing.data.length > 0) return existing.data[0];

  // Create new
  return await stripe.customers.create({
    name: name || `Company ${companyId}`,
    email,
    metadata: { company_id: companyId },
  });
}

/**
 * Verify + parse a Stripe webhook event. Throws if signature is invalid.
 *
 * @param {Buffer|string} rawBody  - raw request body (NOT JSON-parsed)
 * @param {string} signature       - value of 'stripe-signature' header
 * @returns {object}               - parsed Stripe event
 */
function constructWebhookEvent(rawBody, signature) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe not configured');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET not configured — refusing to process webhook');
  }
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

module.exports = {
  getStripe,
  isStripeConfigured,
  reportMeterEvent,
  getOrCreateCustomer,
  constructWebhookEvent,
  STRIPE_API_VERSION,
};
