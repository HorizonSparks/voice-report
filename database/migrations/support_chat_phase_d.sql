-- Support Chat — Phase D
-- Consolidated schema changes for five coordinated features:
--
--   1. is_ai BOOLEAN on support_messages — replaces the brittle
--      `person_name = 'Sparks AI'` string discriminator with a real flag.
--   2. first_response_at + resolved_at on support_conversations — SLA tracking.
--   3. customer_rating on support_conversations — CSAT (1-5) after resolve.
--   4. internal_notes on support_conversations — operator-only notes, never
--      surfaced to the customer.
--
-- Idempotent. Safe to re-run.

SET search_path TO voicereport;

-- ----------------------------------------------------------------------------
-- support_messages.is_ai
-- ----------------------------------------------------------------------------

ALTER TABLE voicereport.support_messages
  ADD COLUMN IF NOT EXISTS is_ai BOOLEAN NOT NULL DEFAULT false;

-- Best-effort backfill of historical AI messages. The discriminator is the
-- legacy `person_name = 'Sparks AI'` convention. Edge cases (a human literally
-- named "Sparks AI", or AI messages stored under another display name) are
-- mis-classified; going forward, /api/support/send and the AI auto-reply path
-- stamp is_ai explicitly so the column is authoritative for new rows.
UPDATE voicereport.support_messages
   SET is_ai = true
 WHERE sender_type = 'support'
   AND person_name = 'Sparks AI'
   AND is_ai = false;

-- ----------------------------------------------------------------------------
-- support_conversations.first_response_at + resolved_at (SLA tracking)
-- ----------------------------------------------------------------------------

ALTER TABLE voicereport.support_conversations
  ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_at       TIMESTAMPTZ;

-- Backfill first_response_at from the earliest non-AI support message per
-- conversation. AI auto-replies (offline mode) explicitly do NOT count toward
-- the SLA — first response is the moment a human starts engaging.
UPDATE voicereport.support_conversations sc
   SET first_response_at = sub.first_human_at
  FROM (
    SELECT conversation_id, MIN(created_at) AS first_human_at
      FROM voicereport.support_messages
     WHERE sender_type = 'support'
       AND is_ai = false
     GROUP BY conversation_id
  ) sub
 WHERE sc.id = sub.conversation_id
   AND sc.first_response_at IS NULL;

-- Backfill resolved_at from updated_at on already-resolved conversations.
-- Approximate (updated_at can shift for other reasons) but the best we can
-- recover from existing rows without a dedicated audit log.
UPDATE voicereport.support_conversations
   SET resolved_at = updated_at
 WHERE status = 'resolved'
   AND resolved_at IS NULL;

-- ----------------------------------------------------------------------------
-- support_conversations.customer_rating (CSAT 1-5)
-- ----------------------------------------------------------------------------

ALTER TABLE voicereport.support_conversations
  ADD COLUMN IF NOT EXISTS customer_rating SMALLINT;

-- Constraint added separately so re-runs don't fail with "constraint already
-- exists". Wrapped in a DO block for idempotency.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'support_conv_customer_rating_range'
  ) THEN
    ALTER TABLE voicereport.support_conversations
      ADD CONSTRAINT support_conv_customer_rating_range
      CHECK (customer_rating IS NULL OR customer_rating BETWEEN 1 AND 5);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- support_conversations.internal_notes (operator-only)
-- ----------------------------------------------------------------------------

ALTER TABLE voicereport.support_conversations
  ADD COLUMN IF NOT EXISTS internal_notes TEXT;

-- ----------------------------------------------------------------------------
-- Verification — surface counts so the operator sees proof of landing.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  ai_msgs INTEGER;
  resolved_with_ts INTEGER;
  with_first_response INTEGER;
BEGIN
  SELECT COUNT(*) INTO ai_msgs FROM voicereport.support_messages WHERE is_ai = true;
  SELECT COUNT(*) INTO resolved_with_ts FROM voicereport.support_conversations WHERE resolved_at IS NOT NULL;
  SELECT COUNT(*) INTO with_first_response FROM voicereport.support_conversations WHERE first_response_at IS NOT NULL;
  RAISE NOTICE 'support_chat_phase_d: is_ai messages=%, resolved_at populated=%, first_response_at populated=%',
    ai_msgs, resolved_with_ts, with_first_response;
END $$;
