-- Registry of which companies have their own dedicated database. Lives in the SHARED (horizon) DB.
-- Empty registry = every company uses the shared DB (today's behavior) — so this is safe to ship dark.
CREATE TABLE IF NOT EXISTS voicereport.company_databases (
  company_id     TEXT PRIMARY KEY,
  db_name        TEXT NOT NULL UNIQUE,
  provisioned_at TIMESTAMP DEFAULT NOW()
);
