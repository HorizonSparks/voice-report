-- Phase 3: per-tenant semantic report memory (RD2's real memory).
-- Also created idempotently at runtime by reportMemory.ensureSchema(), so the feature is
-- correct even where this migration has not been applied. Embeddings are stored as JSON text
-- (no pgvector dependency); similarity is computed in-app over the wall-filtered candidate set.
CREATE TABLE IF NOT EXISTS report_memory (
  id BIGSERIAL PRIMARY KEY,
  report_id TEXT NOT NULL,
  company_id TEXT,
  person_id TEXT,
  project_id TEXT,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  embedding TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_report_memory_company ON report_memory(company_id);
CREATE INDEX IF NOT EXISTS idx_report_memory_person ON report_memory(person_id);
CREATE INDEX IF NOT EXISTS idx_report_memory_report ON report_memory(report_id);
