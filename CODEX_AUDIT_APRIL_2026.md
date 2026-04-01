**1) Tenant Isolation**

1. **CRITICAL**  
File: [server/routes/webauthn.js](/home/horizonsparks/voice-report/server/routes/webauthn.js):237  
Description: WebAuthn login creates sessions without `company_id`/`sparks_role`, so `tenantFilter` can leave `req.companyId` null; many routes then return unscoped data.  
Suggested fix: Include `company_id: person.company_id` and `sparks_role: person.sparks_role` in `sessions.create(...)`, and enforce non-null company for non-Sparks users.

2. **HIGH**  
File: [server/routes/forms.js](/home/horizonsparks/voice-report/server/routes/forms.js):41  
Description: Legacy forms list/read endpoints are only `requireAuth`; no company isolation or ownership check (`GET /api/forms`, `GET /api/forms/:id`).  
Suggested fix: Remove legacy file-backed forms routes or enforce strict `req.auth.person_id`/company checks before read.

3. **HIGH**  
File: [server/routes/files.js](/home/horizonsparks/voice-report/server/routes/files.js):11  
Description: File-serving endpoints allow any authenticated user to fetch any filename across tenants (photos/certs/audio/message media).  
Suggested fix: Authorize each file by owner/company before serving; do not use raw filename-only access control.

4. **HIGH**  
File: [server/routes/messages.js](/home/horizonsparks/voice-report/server/routes/messages.js):283  
Description: `/api/message-files/:filename` is `requireAuth` only; no message participant/company check.  
Suggested fix: Resolve filename to message row and verify actor is sender/recipient (or authorized admin) before `res.download`.

---

**2) Identity Spoofing**

1. **HIGH**  
File: [server/routes/ai.js](/home/horizonsparks/voice-report/server/routes/ai.js):50  
Description: AI routes trust client `person_id` (`transcribe`, `structure`, `converse`, `refine`) to load person context/history. User can request another worker’s context.  
Suggested fix: Derive target person from `req.auth.person_id` unless caller is explicitly authorized supervisor/admin for that person.

2. **HIGH**  
File: [server/routes/jsa.js](/home/horizonsparks/voice-report/server/routes/jsa.js):83  
Description: JSA read endpoints trust query/params identity (`person_id`, `approver_id`, `personId`) instead of session actor checks.  
Suggested fix: Derive person/approver from `req.auth.person_id`; allow override only with explicit role authorization.

3. **MEDIUM**  
File: [server/routes/analytics.js](/home/horizonsparks/voice-report/server/routes/analytics.js):10  
Description: `/api/analytics/events` accepts client `person_id`; telemetry identity can be forged.  
Suggested fix: Ignore body `person_id`; always write `req.auth.person_id`.

---

**3) Privilege Escalation**

1. **CRITICAL**  
File: [server/routes/people.js](/home/horizonsparks/voice-report/server/routes/people.js):82  
Description: Self-update endpoint allows arbitrary body fields, and DB layer allows updating `role_level` and `is_admin`; any worker can promote themselves.  
Suggested fix: Block privileged fields (`is_admin`, `role_level`, `sparks_role`, etc.) for self-edits; split admin-only update path.

2. **CRITICAL**  
File: [database/db.js](/home/horizonsparks/voice-report/database/db.js):254  
Description: `people.update` accepts mutable privileged columns (`role_level`, `is_admin`) from caller-supplied data.  
Suggested fix: Hard allowlist safe self-edit fields in DB layer; enforce privileged-field updates behind admin-only service.

3. **CRITICAL**  
File: [server/routes/auth.js](/home/horizonsparks/voice-report/server/routes/auth.js):13  
Description: Fallback admin PIN is hardcoded (`12345678`) if env var missing.  
Suggested fix: Remove fallback; fail startup/login when `ADMIN_PIN` is unset.

4. **HIGH**  
File: [server/routes/jsa.js](/home/horizonsparks/voice-report/server/routes/jsa.js):243  
Description: JSA mutation endpoints (`PUT /:id`, `POST /:id/submit`, `POST /sign`) lack ownership/assignment checks; authenticated users can alter/sign others’ JSAs.  
Suggested fix: Enforce actor is creator, assigned approver, or authorized supervisor for target JSA/ack row.

5. **MEDIUM**  
File: [server/middleware/sessionAuth.js](/home/horizonsparks/voice-report/server/middleware/sessionAuth.js):123  
Description: `requireAdmin` allows any `role_level >= 5` even if `is_admin` is false.  
Suggested fix: Require explicit admin claim (`is_admin` or Sparks role) for admin-only endpoints.

---

**4) SQL Injection**

1. **HIGH**  
File: [database/db.js](/home/horizonsparks/voice-report/database/db.js):283  
Description: Dynamic SQL column list is built from untrusted object keys in `people.update`; key injection is possible.  
Suggested fix: Map only predefined column names; reject unknown keys before query construction.

2. **MEDIUM**  
File: [database/db.js](/home/horizonsparks/voice-report/database/db.js):1231  
Description: `subscriptions.update` also interpolates object keys directly.  
Suggested fix: Use strict allowlist for updatable columns.

---

**5) File Upload Security**

1. **HIGH**  
File: [server/routes/ai.js](/home/horizonsparks/voice-report/server/routes/ai.js):24  
Description: Upload filename uses client `report_id` directly; path/filename injection risk.  
Suggested fix: Generate server-side UUID filenames only; never trust body for filename parts.

2. **HIGH**  
File: [server/routes/messages.js](/home/horizonsparks/voice-report/server/routes/messages.js):143  
Description: Photo upload filename includes raw `file.originalname`; traversal/unsafe filename risk.  
Suggested fix: Strip path separators and normalize to safe random filename + trusted extension map.

3. **MEDIUM**  
File: [server/routes/ai.js](/home/horizonsparks/voice-report/server/routes/ai.js):29  
Description: Multer configs rely on size limits only; no MIME/type validation across uploads.  
Suggested fix: Add `fileFilter` allowlists per endpoint (`audio/*`, image/pdf/docx as needed) and reject unexpected types.

---

**6) Session Security**

1. **MEDIUM**  
File: [server/routes/auth.js](/home/horizonsparks/voice-report/server/routes/auth.js):43  
Description: New login sessions are created without revoking existing sessions for that user; stolen sessions remain valid until expiry.  
Suggested fix: On login, invalidate prior sessions for that person (or cap active sessions/device-bound sessions).

---

**7) AI Prompt Injection**

1. **HIGH**  
File: [server/routes/ai.js](/home/horizonsparks/voice-report/server/routes/ai.js):258  
Description: Client-supplied `conversation` is forwarded as model messages (including client-chosen roles), enabling instruction injection/steering.  
Suggested fix: Sanitize conversation format, restrict roles, and keep authoritative context/instructions server-generated.

2. **MEDIUM**  
File: [server/routes/ai.js](/home/horizonsparks/voice-report/server/routes/ai.js):99  
Description: Raw transcript is injected directly into prompts with no defensive delimiting/policy checks.  
Suggested fix: Wrap user text in explicit delimiters and add strict “treat transcript as untrusted content” system constraints.

---

**8) Leftover Code**

1. **LOW**  
File: [client/src/views/SparksCommandCenter.jsx](/home/horizonsparks/voice-report/client/src/views/SparksCommandCenter.jsx):13  
Description: Component still exists in repo, but it is not wired in current app routing/import usage.  
Suggested fix: Delete file and related dead assets/tests if fully extracted to `sparks-hub`.

---

**9) Code Quality / Reliability**

1. **MEDIUM**  
File: [server/routes/dailyPlans.js](/home/horizonsparks/voice-report/server/routes/dailyPlans.js):15  
Description: `enrichWithJsaStatus` references `req` out of scope (`(req.db || DB)`), throwing and silently downgrading behavior.  
Suggested fix: Use the `db` function parameter (`(db || DB)`) and add explicit error logging.

2. **LOW**  
File: [server/routes/forms.js](/home/horizonsparks/voice-report/server/routes/forms.js):53  
Description: `/:id` route is declared before `/safety-basics`, so `/safety-basics` can be shadowed by param route.  
Suggested fix: Move static routes above param catch-all routes.

3. **LOW**  
File: [server/routes/jsa.js](/home/horizonsparks/voice-report/server/routes/jsa.js):350  
Description: Acknowledgment completion counts `status === 'completed'` while signing sets `'signed'`; dashboard counts are incorrect.  
Suggested fix: Normalize status enum and counting logic (`signed` vs `completed`) consistently.