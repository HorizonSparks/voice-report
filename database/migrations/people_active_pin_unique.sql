-- DB-enforced global uniqueness of ACTIVE PINs in the shared people table.
-- Login (getByPin) matches by PIN across all companies, so two active people must never share a PIN.
-- This is the real guarantee behind the application-level precheck in db.js people.create/update —
-- the precheck gives a friendly message, this index closes the create/update race window.
-- Partial index (status='active') so deactivated rows can re-use a freed PIN.
CREATE UNIQUE INDEX IF NOT EXISTS people_active_pin_unique ON people (pin) WHERE status = 'active';
