-- Support Chat — Phase E
-- Audit log of state changes on support conversations. Captures who did what
-- and when so disputes ("I never resolved that ticket") and behavioral
-- analytics ("how many reopens per week per agent") become answerable.
--
-- Actions tracked: resolve, reopen, assign, unassign, rate, notes_update.
-- More can be added without schema changes — `action` is opaque text.
--
-- Idempotent. Safe to re-run.

SET search_path TO voicereport;

CREATE TABLE IF NOT EXISTS voicereport.support_conversation_events (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES voicereport.support_conversations(id) ON DELETE CASCADE,
  actor_person_id TEXT,                          -- NULL if event was system-triggered
  action          TEXT NOT NULL,                 -- e.g. 'resolve', 'reopen', 'assign', 'rate'
  payload         JSONB,                         -- action-specific details
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_events_conv
  ON voicereport.support_conversation_events(conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_support_events_actor
  ON voicereport.support_conversation_events(actor_person_id, created_at);

-- Verification
DO $$
DECLARE
  total INTEGER;
BEGIN
  SELECT COUNT(*) INTO total FROM voicereport.support_conversation_events;
  RAISE NOTICE 'support_chat_phase_e: events=%', total;
END $$;
