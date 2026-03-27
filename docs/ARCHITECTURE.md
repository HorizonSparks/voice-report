# Voice Report — Architecture Reference

> This is the operational truth document for the Voice Report app.
> For strategy and product context, see `INTEGRATION_BRIEF.md`.

## Runtime Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | React + Vite | React 19, Vite 8 |
| Backend | Node.js + Express | Express 4 |
| Database | PostgreSQL | pg driver, schema: `voicereport` |
| AI - Transcription | OpenAI Whisper | whisper-1 |
| AI - Reasoning | Anthropic Claude | claude-sonnet |
| Auth | PIN + WebAuthn (Face ID) | @simplewebauthn/server |
| i18n | react-i18next | English + Spanish |
| Process Manager | PM2 | Single process |
| TLS | Self-signed cert | cert.pem / key.pem |

## Authentication Model

- **PIN login** — 4-8 digit PIN, looked up in `people` table or matched against admin PIN
- **Face ID / WebAuthn** — `@simplewebauthn/server` with proper challenge/signature verification
- **Sessions** — PostgreSQL-backed (`app_sessions` table), 7-day expiry
- **Cookie** — `hs_session`, HttpOnly, Secure, SameSite=Lax
- **Session restoration** — Client calls `GET /api/me` on mount to restore session across refreshes
- **Middleware chain** — `loadSession` (global) -> `requireAuth` / `requireAdmin` / `requireRoleLevel` / `requireSelfOrRoleLevel`
- **Authorization** — `server/auth/authz.js` with `getActor`, `canViewPerson`, `canManagePerson`, `canApproveJsa`, `canMessage`
- **Identity rule** — Actor always derived from `req.auth.person_id`, never from client body/params

## Role Levels

| Level | Role | Permissions |
|-------|------|------------|
| 1 | Helper | Basic access, own data only |
| 2 | Journeyman | + Group messages |
| 3 | Foreman | + Create people, manage crew, approve JSA, daily plans |
| 4 | Superintendent | + Delete people, safety JSA approval |
| 5 | Admin | Full access, settings, all trades |

## Database

- **Engine**: PostgreSQL on localhost:5433
- **Database**: `horizon`
- **Schema**: `voicereport` (set via `search_path` on every connection)
- **Driver**: `node-postgres` (pg) — async pool
- **Canonical DB module**: `database/db.js`
- **Deprecated**: `database/db-sqlite.js`, `database/db-pg.js` (dead code, safe to remove)

### Key Tables

| Table | Purpose |
|-------|---------|
| people | All crew members, PINs, roles, trade, supervisor chain |
| reports | Voice reports with transcripts and structured output |
| messages | Private 1-to-1 messaging (text, voice, photo) |
| report_visibility | Precomputed chain-of-command visibility |
| daily_plan_tasks | Persistent tasks with daily entries |
| task_days | Per-day task data (notes, photos, hours, JSA link) |
| jsa_records | Job Safety Analysis forms with 3-stage approval |
| jsa_acknowledgments | Crew member signatures on JSAs |
| app_sessions | Server-side auth sessions |
| webauthn_credentials | WebAuthn public keys and counters |
| company_settings | Company name and logo |
| punch_items | Punch list items |

## Storage Paths

All relative to project root:

| Path | Purpose |
|------|---------|
| `/audio` | Voice report audio files |
| `/photos` | Person photos and task photos |
| `/certs` | Certification uploads |
| `/forms` | Form submission files |
| `/message-photos` | Photo messages |
| `/message-audio` | Voice messages |
| `/templates` | Role template JSON files |
| `/knowledge` | Trade-specific knowledge base (safety, procedures, materials) |
| `/safety_basics.json` | Universal safety rules |

## Route Groups

All mounted at `/api` in `server/index.js`:

| Route File | Mount | Auth | Purpose |
|-----------|-------|------|---------|
| auth.js | `/api` | Public (login/logout) | PIN auth, sessions, /me |
| webauthn.js | `/api/webauthn` | Mixed | Face ID registration (auth required) and login (public) |
| people.js | `/api/people` | requireAuth + role guards | Crew CRUD, photos, certs |
| messages.js | `/api` | requireAuth | Legacy + V2 messaging, photo/voice messages |
| reports.js | `/api/reports` | requireAuth | Voice report CRUD, search |
| dailyPlans.js | `/api/daily-plans` | requireAuth | Daily plans and task assignment |
| tasks.js | `/api/tasks` | requireAuth | Persistent tasks, daily entries, photos, notes |
| jsa.js | `/api/jsa` | requireAuth + role guards | JSA forms, approval workflow, AI mismatch detection |
| punchList.js | `/api/punch-list` | requireAuth + role guards | Punch list CRUD |
| formsV2.js | `/api/forms` | — | Form templates and submissions |
| forms.js | `/api/forms` | — | Legacy forms (deprecated) |
| settings.js | `/api/settings` | requireAuth / requireAdmin | Company settings |
| analytics.js | `/api/analytics` | — | Usage tracking, dashboards |
| ai.js | `/api` | — | Transcription, TTS, conversation, refinement |
| templates.js | `/api/templates` | — | Role templates |
| files.js | `/api` | — | Static file serving |

## AI Pipeline

1. **Whisper** — Audio transcription with trade-specific vocabulary hints
2. **Claude** — Report structuring, safety context, conversation flow
3. **Knowledge base** — Trade-specific JSON files loaded from `/knowledge/`
4. **Safety basics** — Universal safety rules from `/safety_basics.json`

## Deployment

- Single Express server on port 3000 (HTTP) and 3443 (HTTPS)
- Served over local network at `192.168.1.137`
- PM2 process manager (single worker)
- Built client served from `/dist/` (Vite production build)
- WebAuthn challenges stored in-memory (process-local — will break with multiple PM2 workers)

## Test Infrastructure

- **Framework**: Jest + Supertest
- **Run**: `npm test`
- **Suites**: 4 files, 78 tests
- **Coverage**: File paths, auth flow, server config, session middleware, authorization guards, route auth coverage, WebAuthn, DB modules

## Known Deprecated Components

- `database/db-sqlite.js` — Unused SQLite wrapper (app uses PostgreSQL)
- `database/db-pg.js` — Duplicate of db.js
- `database/migrate.js` — SQLite migration script
- `people.webauthn_credential_id` / `webauthn_raw_id` — Legacy WebAuthn fields on people table (migrating to `webauthn_credentials` table)
- `server.js` — Legacy server entry point
- `.challenges/` directory — No longer used (WebAuthn challenges now in-memory)
