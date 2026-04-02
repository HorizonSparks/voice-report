-- ============================================
-- Voice Report — PostgreSQL Schema Migration
-- Migrated from SQLite (schema.sql + db.js auto-migrations)
-- ============================================
-- Usage:
--   psql -U your_user -d your_db -f postgres-schema.sql
--
-- Notes:
--   - TEXT PRIMARY KEY kept (not UUID) for compatibility with existing IDs
--   - INTEGER booleans kept (0/1) for app compatibility
--   - JSON fields stored as TEXT (cast with ::jsonb as needed)
--   - FTS5 replaced with tsvector + GIN indexes
--   - SQLite triggers replaced with PostgreSQL trigger functions
-- ============================================

-- 1. Create schema
CREATE SCHEMA IF NOT EXISTS voicereport;

-- 2. Set search_path
SET search_path TO voicereport;

-- ============================================
-- TABLE 1: templates — Role definitions per trade
-- ============================================
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  template_name TEXT NOT NULL,
  role_level INTEGER NOT NULL DEFAULT 1,
  role_level_title TEXT,
  trade TEXT NOT NULL,
  role_description TEXT,
  report_focus TEXT,
  output_sections TEXT,          -- JSON array
  vocabulary TEXT,               -- JSON object {description, terms[]}
  language_notes TEXT,
  safety_rules TEXT,             -- JSON array
  safety_vocabulary TEXT,        -- JSON array
  tools_and_equipment TEXT,      -- JSON array
  is_system INTEGER DEFAULT 0,   -- 1 = platform template, 0 = client-created
  created_by TEXT,               -- 'platform' or client admin person_id
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- TABLE 2: people — All crew members
-- ============================================
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pin TEXT NOT NULL,
  template_id TEXT REFERENCES templates(id),
  role_title TEXT NOT NULL,
  role_level INTEGER NOT NULL DEFAULT 1,
  trade TEXT,
  supervisor_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'active',
  project_id TEXT DEFAULT 'default',
  photo TEXT,
  is_admin INTEGER DEFAULT 0,
  is_lead_man INTEGER DEFAULT 0,
  access_level TEXT DEFAULT 'user',
  deactivated_at TEXT,
  deactivated_by TEXT,

  -- Personal context
  experience TEXT,
  specialties TEXT,
  certifications TEXT,
  language_preference TEXT,
  notes TEXT,

  -- Override fields
  custom_role_description TEXT,
  custom_report_focus TEXT,
  custom_output_sections TEXT,   -- JSON array
  custom_safety_rules TEXT,      -- JSON array

  -- WebAuthn / Face ID
  webauthn_credential_id TEXT,
  webauthn_raw_id TEXT,
  webauthn_public_key TEXT,

  -- Multi-tenancy
  company_id TEXT,
  sparks_role TEXT,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_people_trade ON people(trade);
CREATE INDEX idx_people_supervisor ON people(supervisor_id);
CREATE INDEX idx_people_role_level ON people(role_level);
CREATE INDEX idx_people_status ON people(status);
CREATE INDEX idx_people_pin ON people(pin);
CREATE INDEX idx_people_company ON people(company_id);

-- ============================================
-- TABLE 3: reports — Voice reports from crew members
-- ============================================
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  person_name TEXT,
  role_title TEXT,
  template_id TEXT REFERENCES templates(id),
  trade TEXT,
  project_id TEXT DEFAULT 'default',
  status TEXT DEFAULT 'complete',

  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW(),

  duration_seconds INTEGER DEFAULT 0,
  audio_files TEXT,              -- JSON array of filenames

  transcript_raw TEXT,
  markdown_verbatim TEXT,
  markdown_structured TEXT,
  conversation_turns TEXT,       -- JSON array of {role, content}

  photos TEXT,                   -- JSON array of photo filenames
  messages_addressed TEXT,       -- JSON array of message IDs

  -- Multi-tenancy
  company_id TEXT,

  -- Full-text search vector (replaces SQLite FTS5)
  search_vector TSVECTOR
);

CREATE INDEX idx_reports_person ON reports(person_id);
CREATE INDEX idx_reports_created ON reports(created_at DESC);
CREATE INDEX idx_reports_trade ON reports(trade);
CREATE INDEX idx_reports_person_date ON reports(person_id, created_at DESC);
CREATE INDEX idx_reports_search ON reports USING GIN(search_vector);
CREATE INDEX idx_reports_company ON reports(company_id);

-- Trigger function: auto-update reports search_vector
CREATE OR REPLACE FUNCTION reports_search_vector_update() RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    SETWEIGHT(TO_TSVECTOR('english', COALESCE(NEW.person_name, '')), 'A') ||
    SETWEIGHT(TO_TSVECTOR('english', COALESCE(NEW.role_title, '')), 'B') ||
    SETWEIGHT(TO_TSVECTOR('english', COALESCE(NEW.transcript_raw, '')), 'C') ||
    SETWEIGHT(TO_TSVECTOR('english', COALESCE(NEW.markdown_structured, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reports_search_vector_trigger
  BEFORE INSERT OR UPDATE ON reports
  FOR EACH ROW
  EXECUTE FUNCTION reports_search_vector_update();

-- ============================================
-- TABLE 4: messages — Private communication between two people
-- ============================================
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES people(id),
  to_id TEXT NOT NULL REFERENCES people(id),
  from_name TEXT,
  to_name TEXT,

  type TEXT DEFAULT 'text',
  content TEXT,
  audio_file TEXT,
  photo TEXT,

  metadata TEXT,                 -- JSON

  read_at TEXT,
  acknowledged_at TEXT,

  created_at TIMESTAMP DEFAULT NOW(),

  -- Full-text search vector (replaces SQLite FTS5)
  search_vector TSVECTOR
);

CREATE INDEX idx_messages_from ON messages(from_id);
CREATE INDEX idx_messages_to ON messages(to_id);
CREATE INDEX idx_messages_conversation ON messages(from_id, to_id, created_at DESC);
CREATE INDEX idx_messages_unread ON messages(to_id) WHERE read_at IS NULL;
CREATE INDEX idx_messages_type ON messages(type);
CREATE INDEX idx_messages_search ON messages USING GIN(search_vector);

-- Trigger function: auto-update messages search_vector
CREATE OR REPLACE FUNCTION messages_search_vector_update() RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    SETWEIGHT(TO_TSVECTOR('english', COALESCE(NEW.from_name, '')), 'B') ||
    SETWEIGHT(TO_TSVECTOR('english', COALESCE(NEW.to_name, '')), 'B') ||
    SETWEIGHT(TO_TSVECTOR('english', COALESCE(NEW.content, '')), 'A');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER messages_search_vector_trigger
  BEFORE INSERT OR UPDATE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION messages_search_vector_update();

-- ============================================
-- TABLE 5: report_visibility — Precomputed chain-of-command visibility
-- ============================================
CREATE TABLE IF NOT EXISTS report_visibility (
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  viewer_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  PRIMARY KEY (person_id, viewer_id)
);

CREATE INDEX idx_visibility_viewer ON report_visibility(viewer_id);

-- ============================================
-- TABLE 6: certifications — Uploaded cert files per person
-- ============================================
CREATE TABLE IF NOT EXISTS certifications (
  id SERIAL PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  cert_name TEXT,
  cert_type TEXT,
  file_path TEXT,
  expiration_date TEXT,
  uploaded_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_certs_person ON certifications(person_id);

-- ============================================
-- TABLE 7: ai_conversations — Per-person assistant memory
-- ============================================
CREATE TABLE IF NOT EXISTS ai_conversations (
  id SERIAL PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  session_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_ai_conv_person ON ai_conversations(person_id, created_at DESC);
CREATE INDEX idx_ai_conv_session ON ai_conversations(session_id);

-- ============================================
-- TABLE 8: daily_instructions — Flowing down the chain
-- ============================================
CREATE TABLE IF NOT EXISTS daily_instructions (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES people(id),
  to_id TEXT NOT NULL REFERENCES people(id),
  from_name TEXT,
  to_name TEXT,
  content TEXT NOT NULL,
  priority TEXT DEFAULT 'normal',
  acknowledged_at TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_instructions_to ON daily_instructions(to_id, created_at DESC);
CREATE INDEX idx_instructions_from ON daily_instructions(from_id);

-- ============================================
-- TABLE 9: ppe_requests — PPE request tracking
-- ============================================
CREATE TABLE IF NOT EXISTS ppe_requests (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL REFERENCES people(id),
  assigned_to TEXT REFERENCES people(id),
  requester_name TEXT,
  items TEXT NOT NULL,            -- JSON array
  status TEXT DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TEXT
);

CREATE INDEX idx_ppe_requester ON ppe_requests(requester_id);
CREATE INDEX idx_ppe_assigned ON ppe_requests(assigned_to);
CREATE INDEX idx_ppe_status ON ppe_requests(status);

-- ============================================
-- TABLE 10: safety_observations — Quick safety reports
-- ============================================
CREATE TABLE IF NOT EXISTS safety_observations (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  person_name TEXT,
  type TEXT DEFAULT 'observation',
  severity TEXT DEFAULT 'low',
  description TEXT NOT NULL,
  location TEXT,
  photo TEXT,
  status TEXT DEFAULT 'open',
  assigned_to TEXT REFERENCES people(id),
  resolution TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TEXT
);

CREATE INDEX idx_safety_person ON safety_observations(person_id);
CREATE INDEX idx_safety_type ON safety_observations(type);
CREATE INDEX idx_safety_status ON safety_observations(status);

-- ============================================
-- TABLE 11: contact_order — Custom contact sort order
-- ============================================
CREATE TABLE IF NOT EXISTS contact_order (
  person_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (person_id, contact_id)
);

-- ============================================
-- TABLE 12: daily_plans — Daily work plans
-- ============================================
CREATE TABLE IF NOT EXISTS daily_plans (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES people(id),
  trade TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_dp_date ON daily_plans(date);
CREATE INDEX idx_dp_created_by ON daily_plans(created_by);

-- ============================================
-- TABLE 13: daily_plan_tasks — Tasks within daily plans
-- ============================================
CREATE TABLE IF NOT EXISTS daily_plan_tasks (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES daily_plans(id) ON DELETE CASCADE,
  assigned_to TEXT REFERENCES people(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'pending',
  priority TEXT DEFAULT 'normal',
  form_id TEXT,
  folder_data TEXT,              -- JSON
  attachments TEXT DEFAULT '[]', -- JSON array
  completed_at TEXT,
  completed_notes TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),

  -- Added via auto-migrations in db.js
  start_date TEXT,
  target_end_date TEXT,
  created_by TEXT,
  trade TEXT,
  location TEXT
);

CREATE INDEX idx_dpt_plan ON daily_plan_tasks(plan_id);
CREATE INDEX idx_dpt_assigned ON daily_plan_tasks(assigned_to);

-- ============================================
-- TABLE 14: task_days — Daily entries within persistent tasks
-- ============================================
CREATE TABLE IF NOT EXISTS task_days (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES daily_plan_tasks(id),
  date TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES people(id),
  jsa_id TEXT,
  shift_notes TEXT,
  shift_audio TEXT,
  shift_transcript TEXT,
  shift_structured TEXT,
  shift_conversation TEXT,       -- JSON
  photos TEXT DEFAULT '[]',      -- JSON array
  forms TEXT DEFAULT '[]',       -- JSON array
  notes TEXT,                    -- JSON array (referenced in code)
  hours_worked REAL,
  weather TEXT,
  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE (task_id, date)
);

CREATE INDEX idx_td_task ON task_days(task_id);
CREATE INDEX idx_td_date ON task_days(date);
CREATE INDEX idx_td_person ON task_days(person_id);

-- ============================================
-- TABLE 15: punch_items — Punch list items
-- ============================================
CREATE TABLE IF NOT EXISTS punch_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  trade TEXT,
  system_name TEXT,
  status TEXT DEFAULT 'open',
  priority TEXT DEFAULT 'normal',
  photo TEXT,
  created_by TEXT NOT NULL REFERENCES people(id),
  assigned_to TEXT REFERENCES people(id),
  form_id TEXT,
  task_id TEXT REFERENCES daily_plan_tasks(id),
  closed_by TEXT REFERENCES people(id),
  closed_at TEXT,
  closed_notes TEXT,
  company_id TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_punch_status ON punch_items(status);
CREATE INDEX idx_punch_assigned ON punch_items(assigned_to);
CREATE INDEX idx_punch_trade ON punch_items(trade);
CREATE INDEX idx_punch_company ON punch_items(company_id);

-- ============================================
-- TABLE 16: form_templates_v2 — Form definitions
-- ============================================
CREATE TABLE IF NOT EXISTS form_templates_v2 (
  id SERIAL PRIMARY KEY,
  form_code TEXT NOT NULL UNIQUE,
  form_title TEXT NOT NULL,
  category TEXT NOT NULL,
  trade TEXT NOT NULL DEFAULT 'Instrumentation',
  version INTEGER NOT NULL DEFAULT 1
);

-- ============================================
-- TABLE 17: form_fields_v2 — Fields within form templates
-- ============================================
CREATE TABLE IF NOT EXISTS form_fields_v2 (
  id SERIAL PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES form_templates_v2(id),
  field_name TEXT NOT NULL,
  field_label TEXT NOT NULL,
  field_type TEXT NOT NULL,
  field_group TEXT,
  display_order INTEGER NOT NULL,
  is_required INTEGER NOT NULL DEFAULT 0,
  unit TEXT,
  select_options TEXT,
  default_value TEXT,
  UNIQUE (template_id, field_name)
);

-- ============================================
-- TABLE 18: form_loops — Instrument loops
-- ============================================
CREATE TABLE IF NOT EXISTS form_loops (
  id SERIAL PRIMARY KEY,
  tag_number TEXT NOT NULL UNIQUE,
  loop_type TEXT NOT NULL,
  service TEXT,
  line_number TEXT,
  pid_system TEXT,
  project_name TEXT NOT NULL DEFAULT '',
  project_number TEXT NOT NULL DEFAULT '',
  area TEXT
);

-- ============================================
-- TABLE 19: form_submissions — Submitted forms
-- ============================================
CREATE TABLE IF NOT EXISTS form_submissions (
  id TEXT PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES form_templates_v2(id),
  loop_id INTEGER REFERENCES form_loops(id),
  tag_number TEXT,
  person_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  technician_name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  submitted_at TEXT,
  reviewer_name TEXT,
  reviewed_at TEXT,
  review_notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fsub_loop ON form_submissions(loop_id);
CREATE INDEX idx_fsub_template ON form_submissions(template_id);
CREATE INDEX idx_fsub_person ON form_submissions(person_id);

-- ============================================
-- TABLE 20: form_submission_values — Field values for submissions
-- ============================================
CREATE TABLE IF NOT EXISTS form_submission_values (
  id SERIAL PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  text_value TEXT,
  numeric_value REAL,
  boolean_value INTEGER,
  json_value TEXT,
  UNIQUE (submission_id, field_name)
);

-- ============================================
-- TABLE 21: form_calibration_points — Calibration data points
-- ============================================
CREATE TABLE IF NOT EXISTS form_calibration_points (
  id SERIAL PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  percent_range REAL NOT NULL,
  input_value REAL,
  input_unit TEXT,
  as_found_output REAL,
  calibrated_output REAL,
  dcs_reading REAL,
  output_unit TEXT,
  UNIQUE (submission_id, percent_range)
);

-- ============================================
-- TABLE 22: jsa_records — Job Safety Analysis records
-- ============================================
CREATE TABLE IF NOT EXISTS jsa_records (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  person_name TEXT NOT NULL,
  trade TEXT,
  date TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  mode TEXT DEFAULT 'shared',
  form_data TEXT DEFAULT '{}',   -- JSON
  supervisor_id TEXT,
  foreman_id TEXT,
  foreman_name TEXT,
  foreman_approved_at TEXT,
  safety_id TEXT,
  safety_name TEXT,
  safety_approved_at TEXT,
  rejection_reason TEXT,
  crew_members TEXT DEFAULT '[]', -- JSON array
  task_id TEXT,
  jsa_number TEXT,
  company_id TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_jsa_company ON jsa_records(company_id);
CREATE INDEX idx_jsa_date ON jsa_records(date);
CREATE INDEX idx_jsa_person ON jsa_records(person_id);
CREATE INDEX idx_jsa_status ON jsa_records(status);

-- ============================================
-- TABLE 23: jsa_acknowledgments — Crew JSA sign-offs
-- ============================================
CREATE TABLE IF NOT EXISTS jsa_acknowledgments (
  id TEXT PRIMARY KEY,
  jsa_id TEXT NOT NULL REFERENCES jsa_records(id),
  person_id TEXT NOT NULL,
  person_name TEXT NOT NULL,
  role_title TEXT,
  my_task TEXT,
  my_hazards TEXT,
  my_controls TEXT,
  ai_conversation TEXT DEFAULT '[]', -- JSON array
  signature TEXT,
  acknowledged_at TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- TABLE 24: analytics_api_calls — API call tracking
-- ============================================
CREATE TABLE IF NOT EXISTS analytics_api_calls (
  id SERIAL PRIMARY KEY,
  request_id TEXT NOT NULL,
  person_id TEXT,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  status_code INTEGER,
  duration_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_aac_endpoint ON analytics_api_calls(endpoint);
CREATE INDEX idx_aac_person ON analytics_api_calls(person_id);
CREATE INDEX idx_aac_created ON analytics_api_calls(created_at);

-- ============================================
-- TABLE 25: analytics_ai_costs — AI usage cost tracking
-- ============================================
CREATE TABLE IF NOT EXISTS analytics_ai_costs (
  id SERIAL PRIMARY KEY,
  request_id TEXT,
  person_id TEXT,
  provider TEXT NOT NULL,
  service TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  audio_duration_seconds INTEGER DEFAULT 0,
  tts_characters INTEGER DEFAULT 0,
  estimated_cost_cents INTEGER DEFAULT 0,
  context_type TEXT,
  knowledge_modules TEXT,
  conversation_round INTEGER,
  phase TEXT,
  success INTEGER DEFAULT 1,
  error_details TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_aic_provider ON analytics_ai_costs(provider);
CREATE INDEX idx_aic_person ON analytics_ai_costs(person_id);
CREATE INDEX idx_aic_service ON analytics_ai_costs(service);
CREATE INDEX idx_aic_created ON analytics_ai_costs(created_at);

-- ============================================
-- TABLE 26: analytics_client_events — Client-side event tracking
-- ============================================
CREATE TABLE IF NOT EXISTS analytics_client_events (
  id SERIAL PRIMARY KEY,
  person_id TEXT,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_data TEXT,               -- JSON
  screen TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_ace_person ON analytics_client_events(person_id);
CREATE INDEX idx_ace_session ON analytics_client_events(session_id);
CREATE INDEX idx_ace_type ON analytics_client_events(event_type);

-- ============================================
-- TABLE 27: analytics_refine_funnels — Refine flow funnel tracking
-- ============================================
CREATE TABLE IF NOT EXISTS analytics_refine_funnels (
  id SERIAL PRIMARY KEY,
  person_id TEXT,
  session_id TEXT,
  funnel_id TEXT NOT NULL,
  context_type TEXT,
  stage TEXT NOT NULL,
  from_stage TEXT,
  round INTEGER DEFAULT 0,
  duration_in_stage_ms INTEGER,
  outcome TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_arf_funnel ON analytics_refine_funnels(funnel_id);
CREATE INDEX idx_arf_stage ON analytics_refine_funnels(stage);

-- ============================================
-- TABLE 28: analytics_sessions — User session tracking
-- ============================================
CREATE TABLE IF NOT EXISTS analytics_sessions (
  id TEXT PRIMARY KEY,
  person_id TEXT,
  started_at TEXT NOT NULL,
  last_activity_at TEXT,
  screens_visited INTEGER DEFAULT 0,
  ai_calls_made INTEGER DEFAULT 0,
  reports_created INTEGER DEFAULT 0,
  user_agent TEXT
);

CREATE INDEX idx_as_person ON analytics_sessions(person_id);

-- ============================================
-- TABLE 29: app_sessions — User sessions
-- ============================================
CREATE TABLE IF NOT EXISTS app_sessions (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0,
  role_level INTEGER DEFAULT 1,
  trade TEXT,
  company_id TEXT,
  sparks_role TEXT,
  user_agent TEXT,
  ip_address TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  last_seen_at TIMESTAMP DEFAULT NOW(),
  last_active TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP
);

CREATE INDEX idx_sessions_person ON app_sessions(person_id);
CREATE INDEX idx_sessions_expires ON app_sessions(expires_at);

-- ============================================
-- TABLE 30: webauthn_credentials — Face ID / biometric login
-- ============================================
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  counter INTEGER DEFAULT 0,
  device_name TEXT,
  transports TEXT,
  device_type TEXT,
  backed_up INTEGER DEFAULT 0,
  last_used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_webauthn_person ON webauthn_credentials(person_id);
CREATE INDEX idx_webauthn_credential ON webauthn_credentials(credential_id);

-- ============================================
-- TABLE 31: companies — Multi-tenant company records
-- ============================================
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  status TEXT DEFAULT 'active',
  tier TEXT DEFAULT 'standard',
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- TABLE 32: company_trades — Licensed trades per company
-- ============================================
CREATE TABLE IF NOT EXISTS company_trades (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  trade TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  licensed_by TEXT,
  licensed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (company_id, trade)
);

-- ============================================
-- TABLE 33: company_products — Licensed products per company
-- ============================================
CREATE TABLE IF NOT EXISTS company_products (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  product TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  licensed_by TEXT,
  licensed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (company_id, product)
);

-- ============================================
-- TABLE 34: company_settings — Per-company settings
-- ============================================
CREATE TABLE IF NOT EXISTS company_settings (
  id SERIAL PRIMARY KEY,
  company_id TEXT,
  company_name TEXT DEFAULT 'Horizon Sparks',
  logo_data TEXT,
  logo_filename TEXT,
  active_role_levels TEXT,         -- JSON
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- TABLE 35: projects — Project records
-- ============================================
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trade TEXT,
  owner_id TEXT,
  description TEXT DEFAULT '',
  color TEXT DEFAULT '#F99440',
  status TEXT DEFAULT 'active',
  company_id TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_projects_company ON projects(company_id);

-- ============================================
-- TABLE 36: project_members — Project membership
-- ============================================
CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL REFERENCES projects(id),
  person_id TEXT NOT NULL,
  role TEXT DEFAULT 'member',
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (project_id, person_id)
);

-- ============================================
-- TABLE 37: knowledge_files — Person knowledge base files
-- ============================================
CREATE TABLE IF NOT EXISTS knowledge_files (
  id SERIAL PRIMARY KEY,
  person_id TEXT NOT NULL,
  uploaded_by TEXT,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT,
  file_path TEXT,
  title TEXT,
  source_type TEXT DEFAULT 'upload',
  text_content TEXT,
  token_estimate INTEGER DEFAULT 0,
  visibility TEXT DEFAULT 'shared',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_knowledge_person ON knowledge_files(person_id);

-- ============================================
-- TABLE 38: jsa_sequence — JSA numbering sequence
-- ============================================
CREATE TABLE IF NOT EXISTS jsa_sequence (
  year INTEGER PRIMARY KEY,
  last_number INTEGER DEFAULT 0
);

-- ============================================
-- TABLE 39: sparks_audit_log — Sparks admin action log
-- ============================================
CREATE TABLE IF NOT EXISTS sparks_audit_log (
  id SERIAL PRIMARY KEY,
  person_id TEXT,
  person_name TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  details TEXT,                    -- JSON
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_created ON sparks_audit_log(created_at DESC);

-- ============================================
-- SHARED FOLDERS & FILES
-- ============================================
CREATE TABLE IF NOT EXISTS shared_folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES people(id),
  context_type TEXT NOT NULL DEFAULT 'team',    -- 'team' or 'company'
  context_id TEXT,                               -- company_id if context_type='company'
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shared_folder_members (
  folder_id TEXT NOT NULL REFERENCES shared_folders(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer',           -- 'owner', 'editor', 'viewer'
  added_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (folder_id, person_id)
);

CREATE TABLE IF NOT EXISTS shared_files (
  id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL REFERENCES shared_folders(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'file',             -- 'file', 'link'
  name TEXT NOT NULL,
  description TEXT,
  -- For type='file': stored filename on disk
  filename TEXT,
  original_name TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  -- For type='link': external URL
  url TEXT,
  -- Metadata
  uploaded_by TEXT NOT NULL REFERENCES people(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_shared_files_folder ON shared_files(folder_id);
CREATE INDEX idx_shared_folder_members_person ON shared_folder_members(person_id);

-- ============================================
-- END OF SCHEMA
-- ============================================
-- To search reports:  SELECT * FROM reports WHERE search_vector @@ TO_TSQUERY('english', 'safety & conduit');
-- To search messages: SELECT * FROM messages WHERE search_vector @@ TO_TSQUERY('english', 'ppe & request');
