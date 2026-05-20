-- Support Chat — Phase C
-- Two coordinated improvements to harden the auto-reply / takeover flow:
--
--   1. last_support_reply_at — records the most recent HUMAN (non-AI) reply
--      timestamp on a conversation. The auto-reply gate uses this to back off
--      for a configurable window after a human enters the conversation and
--      then resume once they disengage. Replaces the previous "any human ever
--      replied" check in support.js, which permanently muted the AI for the
--      rest of the conversation's lifetime.
--
--   2. uniq_support_conv_active_person — unique partial index that enforces
--      the invariant the code already assumes (one active thread per person).
--      Prevents a race between two concurrent customer messages from creating
--      two open conversation rows.
--
-- Safe to re-run: every step is idempotent. Will abort cleanly if pre-existing
-- duplicate active conversations would violate the unique index — in that
-- case, resolve the duplicates manually before re-applying.

SET search_path TO voicereport;

-- ----------------------------------------------------------------------------
-- Step 1: add column + backfill from existing message history
-- ----------------------------------------------------------------------------

ALTER TABLE voicereport.support_conversations
  ADD COLUMN IF NOT EXISTS last_support_reply_at TIMESTAMPTZ;

-- For conversations that already have human replies, seed the new column with
-- the most recent human (non-AI) message timestamp. Without this, every
-- existing conversation would behave as "no human has touched it" until the
-- next manual reply, which would let the AI re-enter ongoing human threads.
--
-- Caveat: the discriminator is the string `person_name != 'Sparks AI'`,
-- which is brittle (a human literally named "Sparks AI" would be missed,
-- and any AI message stored under a different display name would be
-- misclassified as human). This is a best-effort one-shot backfill of
-- pre-existing rows. Going forward, the runtime stamps the column only
-- from /api/support/reply (human-only endpoint), so new conversations
-- are unaffected by this fragility. If stronger discrimination is needed
-- later, add an `is_ai` boolean column to support_messages.
UPDATE voicereport.support_conversations sc
   SET last_support_reply_at = sub.last_human_at
  FROM (
    SELECT conversation_id, MAX(created_at) AS last_human_at
      FROM voicereport.support_messages
     WHERE sender_type = 'support'
       AND person_name IS DISTINCT FROM 'Sparks AI'
     GROUP BY conversation_id
  ) sub
 WHERE sc.id = sub.conversation_id
   AND sc.last_support_reply_at IS NULL;

-- ----------------------------------------------------------------------------
-- Step 2: enforce one active conversation per person
-- ----------------------------------------------------------------------------

-- Guard: bail out with a clear message if existing duplicates would block
-- creation of the unique index. This keeps the migration idempotent and
-- non-destructive — the operator decides how to merge the offending rows.
DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT person_id
      FROM voicereport.support_conversations
     WHERE status IN ('open', 'waiting')
       AND person_id IS NOT NULL
     GROUP BY person_id
    HAVING COUNT(*) > 1
  ) dupes;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'support_chat_phase_c: % person_id(s) have multiple active conversations. Merge duplicates before re-applying.', dup_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_support_conv_active_person
  ON voicereport.support_conversations(person_id)
  WHERE status IN ('open', 'waiting');

-- ----------------------------------------------------------------------------
-- Verification (no-op, surfaces a count so the operator sees proof of landing)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  backfilled INTEGER;
BEGIN
  SELECT COUNT(*) INTO backfilled
    FROM voicereport.support_conversations
   WHERE last_support_reply_at IS NOT NULL;
  RAISE NOTICE 'support_chat_phase_c: conversations with last_support_reply_at populated = %', backfilled;
END $$;
