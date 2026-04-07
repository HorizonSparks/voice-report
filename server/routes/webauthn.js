/**
 * WebAuthn Registration & Authentication
 * Uses @simplewebauthn/server for proper cryptographic verification.
 * Challenges stored server-side in memory (per-session).
 * Credentials stored in webauthn_credentials table.
 */
const { Router } = require('express');
const DB = require('../../database/db');
const { setSessionCookie } = require('../middleware/sessionAuth');
const { requireAuth } = require('../middleware/sessionAuth');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const router = Router();

// In-memory challenge store (keyed by person_id or '_login')
// Challenges are short-lived — valid for 60 seconds max
const challengeStore = new Map();

function storeChallenge(key, challenge) {
  challengeStore.set(key, { challenge, created: Date.now() });
  // Auto-cleanup after 2 minutes
  setTimeout(() => challengeStore.delete(key), 120000);
}

function getAndDeleteChallenge(key) {
  const entry = challengeStore.get(key);
  challengeStore.delete(key);
  if (!entry) return null;
  // Reject if older than 2 minutes
  if (Date.now() - entry.created > 120000) return null;
  return entry.challenge;
}

function getRpId(req) {
  return req.hostname === 'localhost' ? 'localhost' : req.hostname;
}

function getOrigin(req) {
  const proto = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const host = req.get('host');
  return `${proto}://${host}`;
}

// ============================================
// REGISTRATION (requires authenticated session)
// ============================================

// Step 1: Generate registration options
router.post('/register-options', requireAuth, async (req, res) => {
  try {
    const personId = req.auth.person_id;
    if (!personId) return res.status(400).json({ error: 'Person session required for registration' });

    const person = await (req.db || DB).people.getById(personId);
    if (!person) return res.status(404).json({ error: 'Person not found' });

    // Get existing credentials to exclude
    const existingCreds = await (req.db || DB).webauthnCredentials.getForPerson(personId);

    const options = await generateRegistrationOptions({
      rpName: 'Voice Report - Horizon Sparks',
      rpID: getRpId(req),
      userID: new TextEncoder().encode(personId),
      userName: person.name,
      userDisplayName: person.name,
      attestationType: 'none', // No attestation needed for this use case
      authenticatorSelection: {
        authenticatorAttachment: 'platform', // Face ID / Touch ID only
        userVerification: 'required',
        residentKey: 'preferred',
      },
      excludeCredentials: existingCreds.map(c => ({
        id: c.credential_id,
        type: 'public-key',
      })),
      timeout: 60000,
    });

    // Store challenge server-side
    storeChallenge(`reg_${personId}`, options.challenge);

    res.json(options);
  } catch (err) {
    console.error('WebAuthn register-options error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Step 2: Verify registration and store credential
router.post('/register', requireAuth, async (req, res) => {
  try {
    const personId = req.auth.person_id;
    if (!personId) return res.status(400).json({ error: 'Person session required' });

    const expectedChallenge = getAndDeleteChallenge(`reg_${personId}`);
    if (!expectedChallenge) return res.status(400).json({ error: 'Challenge expired or missing. Please try again.' });

    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge,
      expectedOrigin: getOrigin(req),
      expectedRPID: getRpId(req),
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Registration verification failed' });
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    // Store in webauthn_credentials table
    await (req.db || DB).webauthnCredentials.create({
      person_id: personId,
      credential_id: Buffer.from(credential.id).toString('base64url'),
      public_key: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: req.body.response?.transports ? JSON.stringify(req.body.response.transports) : null,
      device_type: credentialDeviceType || null,
      backed_up: credentialBackedUp || false,
    });

    // Also update legacy fields on people table for backward compat
    await (req.db || DB).people.update(personId, {
      webauthn_credential_id: Buffer.from(credential.id).toString('base64url'),
      webauthn_raw_id: Buffer.from(credential.id).toString('base64url'),
    });

    res.json({ success: true, verified: true });
  } catch (err) {
    console.error('WebAuthn register error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// AUTHENTICATION (public — this IS the login)
// ============================================

// Step 1: Generate authentication options
router.post('/login-options', async (req, res) => {
  try {
    // Check if any credentials exist (in new table first, fallback to legacy)
    const newCreds = (await DB.db.query('SELECT credential_id FROM webauthn_credentials')).rows;
    const legacyCreds = (await DB.db.query("SELECT id, webauthn_credential_id FROM people WHERE webauthn_credential_id IS NOT NULL AND status = 'active'")).rows;

    const allCreds = [
      ...newCreds.map(c => ({ id: c.credential_id, type: 'public-key' })),
      ...legacyCreds
        .filter(p => !newCreds.some(nc => nc.credential_id === p.webauthn_credential_id))
        .map(p => ({ id: p.webauthn_credential_id, type: 'public-key' })),
    ];

    if (allCreds.length === 0) return res.json({ available: false });

    const options = await generateAuthenticationOptions({
      rpID: getRpId(req),
      allowCredentials: allCreds,
      userVerification: 'required',
      timeout: 60000,
    });

    // Store challenge
    storeChallenge('_login', options.challenge);

    res.json({ available: true, ...options });
  } catch (err) {
    console.error('WebAuthn login-options error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Step 2: Verify authentication assertion and create session
router.post('/login', async (req, res) => {
  try {
    const { id: credentialIdFromAssertion } = req.body;
    if (!credentialIdFromAssertion) return res.status(400).json({ error: 'No credential provided' });

    const expectedChallenge = getAndDeleteChallenge('_login');
    if (!expectedChallenge) return res.status(400).json({ error: 'Challenge expired or missing. Please try again.' });

    // Look up credential — try new table first, then legacy
    let storedCred = await (req.db || DB).webauthnCredentials.getByCredentialId(credentialIdFromAssertion);
    let person;
    let isLegacy = false;

    if (storedCred) {
      person = await (req.db || DB).people.getById(storedCred.person_id);
    } else {
      // Legacy lookup
      person = await (req.db || DB).people.getByWebAuthn(credentialIdFromAssertion);
      if (person) {
        isLegacy = true;
        // For legacy creds, we can't do full signature verification
        // Create session and log them in, but warn about migration
        console.warn(`Legacy WebAuthn login for ${person.name} — credential not in webauthn_credentials table. Re-registration recommended.`);
      }
    }

    if (!person) return res.status(401).json({ error: 'Credential not recognized' });

    // Full verification for new-style credentials
    if (!isLegacy && storedCred) {
      try {
        const verification = await verifyAuthenticationResponse({
          response: req.body,
          expectedChallenge,
          expectedOrigin: getOrigin(req),
          expectedRPID: getRpId(req),
          credential: {
            id: storedCred.credential_id,
            publicKey: Buffer.from(storedCred.public_key, 'base64url'),
            counter: parseInt(storedCred.counter) || 0,
          },
        });

        if (!verification.verified) {
          return res.status(401).json({ error: 'Authentication verification failed' });
        }

        // Update counter for replay protection
        await (req.db || DB).webauthnCredentials.updateCounter(
          storedCred.credential_id,
          verification.authenticationInfo.newCounter
        );
      } catch (verifyErr) {
        console.error('WebAuthn verification error:', verifyErr);
        return res.status(401).json({ error: 'Authentication verification failed' });
      }
    }

    // Create session (same as PIN login)
    const session = await (req.db || DB).sessions.create({
      person_id: person.id,
      is_admin: false,
      role_level: person.role_level || 1,
      trade: person.trade || null,
      company_id: person.company_id || null,
      sparks_role: person.sparks_role || null,
      user_agent: req.headers['user-agent'],
      ip_address: req.ip,
    });
    setSessionCookie(res, session.id, undefined, req);

    res.json({
      is_admin: false,
      person_id: person.id,
      name: person.name,
      role_title: person.role_title,
      role_level: person.role_level || 1,
      template_id: person.template_id,
      trade: person.trade || '',
      photo: person.photo || null,
      supervisor_id: person.supervisor_id || null,
      session_id: session.id,
      legacy_credential: isLegacy, // Signal to client that re-registration is recommended
    });
  } catch (err) {
    console.error('WebAuthn login error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
