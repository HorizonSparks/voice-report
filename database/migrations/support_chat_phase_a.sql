-- Support Chat — Phase A
-- Creates support_conversations + support_messages tables that
-- /server/routes/support.js has been calling against (currently 500s).
-- Adds extension columns for cross-app origin tracking + AI suggestions.
--
-- Safe to re-run: uses IF NOT EXISTS guards on tables, columns, and indexes.

SET search_path TO voicereport;

-- ============================================
-- support_conversations
--   One open thread per (person_id, status='open'|'waiting').
--   Status transitions: open → waiting (after support reply) → resolved.
-- ============================================
-- NOTE: company_id and person_id are intentionally NOT foreign keys.
-- PIDS-app customers authenticate via Keycloak and may not exist in
-- voicereport.people / voicereport.companies. Treating these as opaque
-- external identifiers keeps the integration path safe on a fresh DB.
CREATE TABLE IF NOT EXISTS support_conversations (
  id            TEXT PRIMARY KEY,
  company_id    TEXT,
  person_id     TEXT,
  person_name   TEXT,
  person_role   TEXT,
  company_name  TEXT,
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'waiting', 'resolved')),
  last_message  TEXT,
  last_message_at TIMESTAMPTZ,
  -- Cross-app + context fields (Phase A extensions)
  app_origin    TEXT NOT NULL DEFAULT 'voicereport'
                CHECK (app_origin IN ('voicereport', 'pids-app')),
  current_route TEXT,
  screen_context JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- If the table already existed (e.g. partial install), additively patch the
-- extension columns so we never lose data.
ALTER TABLE support_conversations
  ADD COLUMN IF NOT EXISTS app_origin    TEXT NOT NULL DEFAULT 'voicereport',
  ADD COLUMN IF NOT EXISTS current_route TEXT,
  ADD COLUMN IF NOT EXISTS screen_context JSONB;

CREATE INDEX IF NOT EXISTS idx_support_conv_person_status
  ON support_conversations(person_id, status);

CREATE INDEX IF NOT EXISTS idx_support_conv_status_lastmsg
  ON support_conversations(status, last_message_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_support_conv_company
  ON support_conversations(company_id);

CREATE INDEX IF NOT EXISTS idx_support_conv_app_origin
  ON support_conversations(app_origin);

-- ============================================
-- support_messages
--   sender_type: 'customer' (whoever opened the thread) | 'support' (Sparks).
--   read_at: set when the OPPOSITE side opens the conversation.
-- ============================================
CREATE TABLE IF NOT EXISTS support_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  company_id      TEXT,
  person_id       TEXT,
  person_name     TEXT,
  person_role     TEXT,
  company_name    TEXT,
  sender_type     TEXT NOT NULL
                  CHECK (sender_type IN ('customer', 'support')),
  content         TEXT NOT NULL,
  message_type    TEXT NOT NULL DEFAULT 'text',
  file_url        TEXT,
  read_at         TIMESTAMPTZ,
  -- AI hooks (Phase A extensions)
  ai_suggested_reply TEXT,
  ai_confidence      REAL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Additive patch for partial installs.
ALTER TABLE support_messages
  ADD COLUMN IF NOT EXISTS ai_suggested_reply TEXT,
  ADD COLUMN IF NOT EXISTS ai_confidence      REAL;

CREATE INDEX IF NOT EXISTS idx_support_msg_conv_created
  ON support_messages(conversation_id, created_at);

-- Partial index — fastest path for the unread-count query in support.js.
CREATE INDEX IF NOT EXISTS idx_support_msg_unread_customer
  ON support_messages(conversation_id)
  WHERE sender_type = 'customer' AND read_at IS NULL;

-- ============================================
-- Verification (no-op, just emits row counts so the operator sees
-- proof the migration landed without errors).
-- ============================================
DO $$
DECLARE
  conv_count INTEGER;
  msg_count  INTEGER;
BEGIN
  SELECT count(*) INTO conv_count FROM support_conversations;
  SELECT count(*) INTO msg_count  FROM support_messages;
  RAISE NOTICE 'support_chat_phase_a: conversations=%, messages=%', conv_count, msg_count;
END $$;

-- ============================================
-- 2026-04-26 patch: drop NOT NULL on company_id.
-- Original DDL above already declares it NULLable, but the prod DB was
-- created from an earlier draft that had NOT NULL. PIDS-app customers
-- authenticate via Keycloak and may not carry a voicereport company_id,
-- so a non-null constraint here would 500 every cross-app message.
-- Idempotent — no-op if the column is already NULLable.
-- ============================================
ALTER TABLE support_conversations ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE support_messages      ALTER COLUMN company_id DROP NOT NULL;
