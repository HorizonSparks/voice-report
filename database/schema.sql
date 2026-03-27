-- Voice Report Database Schema
-- SQLite database for Voice Report system
-- Replaces JSON file storage for better AI querying, search, and privacy control

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- ============================================
-- TEMPLATES — Role definitions per trade
-- ============================================
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  template_name TEXT NOT NULL,
  role_level INTEGER NOT NULL DEFAULT 1,
  role_level_title TEXT,
  trade TEXT NOT NULL,  -- 'Electrical', 'Instrumentation', 'Safety'
  role_description TEXT,
  report_focus TEXT,
  output_sections TEXT,  -- JSON array
  vocabulary TEXT,       -- JSON object {description, terms[]}
  language_notes TEXT,
  safety_rules TEXT,     -- JSON array
  safety_vocabulary TEXT, -- JSON array
  tools_and_equipment TEXT, -- JSON array
  is_system INTEGER DEFAULT 0,  -- 1 = platform template (Horizon Sparks), 0 = client-created
  created_by TEXT,  -- 'platform' or client admin person_id
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ============================================
-- PEOPLE — All crew members
-- ============================================
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pin TEXT NOT NULL,
  template_id TEXT REFERENCES templates(id),
  role_title TEXT NOT NULL,
  role_level INTEGER NOT NULL DEFAULT 1,
  trade TEXT,  -- denormalized from template for fast filtering
  supervisor_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'active',  -- 'active', 'inactive', 'deleted' (soft-delete)
  project_id TEXT DEFAULT 'default',
  photo TEXT,  -- filename in photos/
  is_admin INTEGER DEFAULT 0,
  access_level TEXT DEFAULT 'user',  -- 'superadmin' (Horizon Sparks), 'admin' (client PM), 'user' (worker)
  deactivated_at TEXT,  -- when soft-deleted/deactivated
  deactivated_by TEXT,  -- who deactivated them

  -- Personal context (was JSON blob, now individual columns for AI querying)
  experience TEXT,
  specialties TEXT,
  certifications TEXT,
  language_preference TEXT,
  notes TEXT,

  -- Override fields (person-specific overrides of template defaults)
  custom_role_description TEXT,
  custom_report_focus TEXT,
  custom_output_sections TEXT,  -- JSON array
  custom_safety_rules TEXT,     -- JSON array

  -- WebAuthn / Face ID
  webauthn_credential_id TEXT,
  webauthn_raw_id TEXT,
  webauthn_public_key TEXT,

  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_people_trade ON people(trade);
CREATE INDEX idx_people_supervisor ON people(supervisor_id);
CREATE INDEX idx_people_role_level ON people(role_level);
CREATE INDEX idx_people_status ON people(status);
CREATE INDEX idx_people_pin ON people(pin);

-- ============================================
-- REPORTS — Voice reports from crew members
-- ============================================
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  person_name TEXT,  -- denormalized for quick display
  role_title TEXT,   -- denormalized
  template_id TEXT REFERENCES templates(id),
  trade TEXT,        -- denormalized for filtering
  project_id TEXT DEFAULT 'default',
  status TEXT DEFAULT 'complete',  -- 'recording', 'processing', 'complete'

  -- Timestamps
  created_at TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')),

  -- Audio
  duration_seconds INTEGER DEFAULT 0,
  audio_files TEXT,  -- JSON array of filenames

  -- Content
  transcript_raw TEXT,         -- Original spoken words
  markdown_verbatim TEXT,      -- Cleaned-up verbatim
  markdown_structured TEXT,    -- AI-structured report
  conversation_turns TEXT,     -- JSON array of {role, content} turns

  -- Photos attached during report
  photos TEXT,  -- JSON array of photo filenames

  -- Message integration
  messages_addressed TEXT  -- JSON array of message IDs addressed in this report
);

CREATE INDEX idx_reports_person ON reports(person_id);
CREATE INDEX idx_reports_created ON reports(created_at DESC);
CREATE INDEX idx_reports_trade ON reports(trade);
CREATE INDEX idx_reports_person_date ON reports(person_id, created_at DESC);

-- Full-text search on report content (for AI queries)
CREATE VIRTUAL TABLE IF NOT EXISTS reports_fts USING fts5(
  id UNINDEXED,
  person_name,
  role_title,
  transcript_raw,
  markdown_structured,
  content='reports',
  content_rowid='rowid'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS reports_ai AFTER INSERT ON reports BEGIN
  INSERT INTO reports_fts(rowid, id, person_name, role_title, transcript_raw, markdown_structured)
  VALUES (new.rowid, new.id, new.person_name, new.role_title, new.transcript_raw, new.markdown_structured);
END;

CREATE TRIGGER IF NOT EXISTS reports_ad AFTER DELETE ON reports BEGIN
  INSERT INTO reports_fts(reports_fts, rowid, id, person_name, role_title, transcript_raw, markdown_structured)
  VALUES ('delete', old.rowid, old.id, old.person_name, old.role_title, old.transcript_raw, old.markdown_structured);
END;

CREATE TRIGGER IF NOT EXISTS reports_au AFTER UPDATE ON reports BEGIN
  INSERT INTO reports_fts(reports_fts, rowid, id, person_name, role_title, transcript_raw, markdown_structured)
  VALUES ('delete', old.rowid, old.id, old.person_name, old.role_title, old.transcript_raw, old.markdown_structured);
  INSERT INTO reports_fts(rowid, id, person_name, role_title, transcript_raw, markdown_structured)
  VALUES (new.rowid, new.id, new.person_name, new.role_title, new.transcript_raw, new.markdown_structured);
END;

-- ============================================
-- MESSAGES — Private communication between two people
-- ============================================
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES people(id),
  to_id TEXT NOT NULL REFERENCES people(id),
  from_name TEXT,  -- denormalized
  to_name TEXT,    -- denormalized

  -- Content
  type TEXT DEFAULT 'text',  -- 'text', 'voice', 'photo', 'ppe_request', 'safety_alert'
  content TEXT,              -- message body (text or transcript)
  audio_file TEXT,           -- filename if voice message
  photo TEXT,                -- filename if photo

  -- For special message types
  metadata TEXT,  -- JSON: {ppe_items: [...], priority: 'normal|urgent', status: 'pending|acknowledged|completed'}

  -- Read tracking
  read_at TEXT,  -- null = unread
  acknowledged_at TEXT,

  -- Privacy: ONLY from_id and to_id can see this message
  -- The AI must filter by these fields

  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_messages_from ON messages(from_id);
CREATE INDEX idx_messages_to ON messages(to_id);
CREATE INDEX idx_messages_conversation ON messages(from_id, to_id, created_at DESC);
CREATE INDEX idx_messages_unread ON messages(to_id, read_at) WHERE read_at IS NULL;
CREATE INDEX idx_messages_type ON messages(type);

-- Full-text search on messages (for AI queries — respects privacy via JOIN)
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  id UNINDEXED,
  from_name,
  to_name,
  content,
  content='messages',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, id, from_name, to_name, content)
  VALUES (new.rowid, new.id, new.from_name, new.to_name, new.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, id, from_name, to_name, content)
  VALUES ('delete', old.rowid, old.id, old.from_name, old.to_name, old.content);
END;

-- ============================================
-- CHAIN OF COMMAND — Precomputed visibility
-- Who can see whose reports (for fast AI queries)
-- ============================================
CREATE TABLE IF NOT EXISTS report_visibility (
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  viewer_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  PRIMARY KEY (person_id, viewer_id)
);

-- Example: If Danny (journeyman) reports to Jose (foreman) who reports to Ray (GF)
-- who reports to Carlos (supt) who reports to Mike (PM), then:
-- report_visibility has: (Danny, Jose), (Danny, Ray), (Danny, Carlos), (Danny, Mike)
-- So when Mike's AI asks for reports, it queries:
-- SELECT * FROM reports WHERE person_id IN (SELECT person_id FROM report_visibility WHERE viewer_id = 'mike_id')

CREATE INDEX idx_visibility_viewer ON report_visibility(viewer_id);

-- ============================================
-- CERTIFICATIONS — Uploaded cert files per person
-- ============================================
CREATE TABLE IF NOT EXISTS certifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  cert_name TEXT,       -- 'OSHA 30', 'Journeyman License', etc.
  cert_type TEXT,       -- 'card', 'document', 'license'
  file_path TEXT,       -- filename in certs/
  expiration_date TEXT, -- when it expires (nullable)
  uploaded_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_certs_person ON certifications(person_id);

-- ============================================
-- AI CONVERSATION HISTORY — Per-person assistant memory
-- ============================================
CREATE TABLE IF NOT EXISTS ai_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  session_id TEXT,  -- groups turns into sessions
  role TEXT NOT NULL,  -- 'user', 'assistant'
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_ai_conv_person ON ai_conversations(person_id, created_at DESC);
CREATE INDEX idx_ai_conv_session ON ai_conversations(session_id);

-- ============================================
-- DAILY INSTRUCTIONS — Flowing down the chain
-- ============================================
CREATE TABLE IF NOT EXISTS daily_instructions (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES people(id),
  to_id TEXT NOT NULL REFERENCES people(id),
  from_name TEXT,
  to_name TEXT,
  content TEXT NOT NULL,
  priority TEXT DEFAULT 'normal',  -- 'normal', 'urgent', 'safety'
  acknowledged_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_instructions_to ON daily_instructions(to_id, created_at DESC);
CREATE INDEX idx_instructions_from ON daily_instructions(from_id);

-- ============================================
-- PPE REQUESTS — Special message type with tracking
-- ============================================
CREATE TABLE IF NOT EXISTS ppe_requests (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL REFERENCES people(id),
  assigned_to TEXT REFERENCES people(id),  -- safety officer or supervisor
  requester_name TEXT,
  items TEXT NOT NULL,  -- JSON array: [{item: 'safety glasses', qty: 1, size: 'L'}]
  status TEXT DEFAULT 'pending',  -- 'pending', 'approved', 'delivered', 'denied'
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX idx_ppe_requester ON ppe_requests(requester_id);
CREATE INDEX idx_ppe_assigned ON ppe_requests(assigned_to);
CREATE INDEX idx_ppe_status ON ppe_requests(status);

-- ============================================
-- SAFETY OBSERVATIONS — Quick safety reports
-- ============================================
CREATE TABLE IF NOT EXISTS safety_observations (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  person_name TEXT,
  type TEXT DEFAULT 'observation',  -- 'observation', 'near_miss', 'hazard', 'incident'
  severity TEXT DEFAULT 'low',      -- 'low', 'medium', 'high', 'critical'
  description TEXT NOT NULL,
  location TEXT,
  photo TEXT,  -- filename
  status TEXT DEFAULT 'open',  -- 'open', 'in_progress', 'resolved', 'closed'
  assigned_to TEXT REFERENCES people(id),
  resolution TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX idx_safety_person ON safety_observations(person_id);
CREATE INDEX idx_safety_type ON safety_observations(type);
CREATE INDEX idx_safety_status ON safety_observations(status);
