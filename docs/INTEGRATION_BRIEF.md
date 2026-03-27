# Horizon Sparks — Platform + Voice Report Integration Brief

## Purpose of this document
I need to have a deep conversation about how to integrate two products that I'm building under Horizon Sparks. I need help thinking through the best approach — not just technically, but strategically. Both products work today independently. The question is: how do they become one ecosystem without breaking what works?

---

## PRODUCT 1: Horizon Sparks Platform (on DGX Spark)

### What it is
A web platform for managing industrial construction projects. It handles document management, P&ID recognition (AI-powered), loop folder organization, and project collaboration. It's built by a small team (2 developers + me directing).

### Tech Stack
- **Frontend**: Next.js (React), runs on port 3032
- **Backend API**: Node.js Express ("pids-api"), runs on port 82
- **Database**: PostgreSQL (container named `postgress_horizonsparks`)
- **GraphQL Layer**: Hasura — sits on top of PostgreSQL, provides GraphQL API for the frontend
- **Auth**: Keycloak (SSO, OAuth2) — manages all user accounts, roles, sessions
- **File Storage**: MinIO (S3-compatible object storage) — stores all documents, P&IDs, images
- **AI Model**: YOLO-based P&ID recognition model (runs in Docker, should use GPU)
- **Infrastructure**: Docker Compose on NVIDIA DGX Spark (ARM64, 128GB RAM, GB10 GPU)
- **Domain**: app.horizonsparks.ai (Keycloak at keycloak.horizonsparks.ai)

### Database Schema (PostgreSQL, schema: `horizonsparks`)
```
users (id UUID, email, photo_url, username, firstname, lastname)
  — Synced from Keycloak. UUID matches Keycloak user ID.

projects (id UUID, name, owner_id UUID→users, address, company, description, deadline, priority_id)
  — Each construction project (e.g., "BXP Crossroads", "Gillis Amine Unit")

project_members (id UUID, project_id UUID→projects, user_id UUID→users)
  — Who belongs to which project

project_member_roles (id UUID, project_member_id UUID→project_members, role TEXT)
  — What role each member has in the project

files (id UUID, + versions, comments, signatures, tags, labels)
  — Document management system with full version history

loopfolder (id UUID, + associated files)
  — Core IP: organizes instrument loops with their associated documents

model, model_flow, files_model, box_crop_images
  — AI model data for P&ID recognition
```

### Key Design Decisions
- **UUIDs everywhere** — all IDs are UUID v4
- **Keycloak is the single source of truth for users** — no local user table with passwords
- **Hasura provides GraphQL** — frontend talks to Hasura, not directly to the API for most data
- **MinIO for all files** — nothing stored on local filesystem
- **Multi-project** — one platform, many projects, users can be in multiple projects with different roles

### What it does NOT have
- No concept of trades (Electrical, Instrumentation, Pipe Fitting)
- No people hierarchy (PM → Superintendent → GF → Foreman → Journeyman → Helper)
- No daily task management
- No JSA (Job Safety Analysis) system
- No voice input or AI-assisted reporting
- No mobile-optimized field interface
- No daily reports or shift updates
- No safety compliance tracking

---

## PRODUCT 2: Voice Report App (currently on Mac, deploying to DGX Spark)

### What it is
A mobile-first web app for construction field crews. Workers use voice to report daily progress, create tasks, fill out JSAs, and communicate. AI (Claude) processes voice input, asks smart follow-up questions, and structures data. It's designed for people wearing hard hats and gloves — big buttons, voice-first, minimal typing.

### Tech Stack
- **Frontend**: React 18 + Vite (SPA), mobile-optimized
- **Backend**: Node.js Express
- **Database**: SQLite (better-sqlite3) — single file database
- **Auth**: PIN-based (4-8 digit PINs per person) + Face ID/WebAuthn
- **File Storage**: Local filesystem (`/photos/`, `/certs/`, `/audio/`)
- **AI**: OpenAI Whisper (transcription) + Claude API (reasoning, structuring, conversation)
- **i18n**: English + Spanish (270+ keys each)
- **Domain**: voice-report.ai (planned, not yet deployed)

### Database Schema (SQLite)
```
people (id TEXT like "person_pm_henderson", name, pin, template_id, role_title,
        role_level 0-5, trade, supervisor_id→people, status, experience,
        specialties, certifications, language_preference, photo, webauthn credentials)
  — Full hierarchy with personal context for AI conversations

templates (id TEXT, template_name, role_level, trade, role_description, report_focus,
           output_sections JSON, vocabulary JSON, safety_rules JSON, tools_and_equipment JSON)
  — 25 role templates across 5 trades defining how AI interacts with each role

daily_plans (id, date, created_by→people, trade)
daily_plan_tasks (id, plan_id→daily_plans, assigned_to→people, title, description,
                  status, priority, trade, location, start_date, target_end_date)
  — Task management: persistent tasks that span multiple days

task_days (id, task_id→tasks, date, person_id, jsa_id, shift_structured,
           shift_notes, shift_audio, shift_transcript, photos JSON, hours_worked)
  — Daily entries per task: JSA + daily report + photos for each day

jsa_records (id, person_id, person_name, trade, date, status, mode, form_data JSON,
             foreman_id, foreman_approved_at, safety_id, safety_approved_at,
             crew_members JSON, jsa_number, task_id)
  — Job Safety Analysis with approval workflow (draft → foreman → safety → active)

jsa_acknowledgments (id, jsa_id, person_id, person_name, role_title,
                     my_task, my_hazards, my_controls, signature, status)
  — Individual crew member sign-offs on JSAs

reports (id, person_id, transcript_raw, transcript_ai, audio_file, photos JSON,
         form_code, structured_data JSON, created_at)
  — Voice reports processed by AI

messages (id, from_id→people, to_id→people, content, type, metadata JSON)
  — Internal messaging including safety alerts

form_templates_v2 + form_fields_v2 + form_submissions + form_field_values
  — 27 inspection/calibration forms across 5 trades (HS-IC, HS-EL, HS-PF, HS-ER, HS-SF codes)
```

### Key Design Decisions
- **Text IDs** (human-readable like `person_pm_henderson`) — not UUIDs
- **PIN auth** — fast field access, no email/password (workers may not have email)
- **SQLite** — simple, no server needed, fast for single-machine deployment
- **Local file storage** — photos saved directly to disk
- **Role hierarchy baked in** — supervisor_id chain, role_level 0-5, trade-specific templates
- **AI-first** — every interaction can be voice-driven, AI structures the data
- **Offline-capable design** — works on local network, doesn't need internet (except for AI API calls)

### What it does NOT have
- No document management (P&IDs, drawings, specs)
- No loop folder system
- No AI model for document recognition
- No project-level organization (everything is one "default" project)
- No Keycloak/SSO integration
- No GraphQL
- No cloud file storage (MinIO/S3)

---

## THE INTEGRATION QUESTION

### What we want to achieve
A construction foreman should be able to:
1. Log into ONE system (or seamlessly move between Platform and Voice Report)
2. See their project's documents (from Platform) AND their crew's daily tasks/JSAs/reports (from Voice Report)
3. A superintendent on the Platform should see daily field reports coming in from Voice Report
4. Files uploaded in Voice Report (photos, forms) should be accessible from the Platform
5. Users created in one system should exist in the other

### The tensions / decisions to make

**1. User Identity — UUID vs Text ID vs PIN**
- Platform: Users are UUIDs from Keycloak. Auth via email/password + SSO.
- Voice Report: Users are text IDs with PINs. Many field workers don't have email.
- Question: Do we force all Voice Report users into Keycloak? Or do we create a bridge? Field workers need fast PIN access — they can't type passwords on a phone with gloves. But we also need single sign-on for supervisors who use both systems.
- Possible approach: Keycloak manages the account (UUID), but Voice Report allows PIN as a quick-unlock method (like a phone PIN). The person record has both `keycloak_id` (UUID) and `pin`. Supervisors can use either. Field workers use PIN only but their data syncs to the Keycloak user.

**2. Database — SQLite vs PostgreSQL**
- Platform: PostgreSQL (proper production database, handles concurrent users, managed by Hasura)
- Voice Report: SQLite (fast, simple, but single-writer, no concurrent access, not production-grade)
- Question: Should Voice Report migrate to PostgreSQL before deployment? Or keep SQLite and sync data to Platform's PostgreSQL?
- Consideration: Voice Report is designed to work on local networks, potentially offline. SQLite makes this possible. PostgreSQL requires a running server. If Voice Report moves to PostgreSQL on the DGX, it loses offline capability.
- Possible approach: Keep SQLite for now (it works, it's fast, it's simple). Add a sync layer that pushes data to Platform's PostgreSQL periodically. Voice Report is the "field tool" — it should be resilient. Platform is the "office tool" — it aggregates.

**3. File Storage — Local vs MinIO**
- Platform: All files in MinIO (S3-compatible). Proper object storage with versioning.
- Voice Report: Photos and audio on local disk (`/photos/`, `/audio/`).
- Question: Should Voice Report upload to MinIO directly? Or sync files periodically?
- Consideration: MinIO requires network access. If Voice Report is on the same DGX as MinIO, it's fast. But if Voice Report ever runs on a separate device (foreman's tablet as a local server), MinIO might not be reachable.
- Possible approach: Voice Report saves locally first (always works), then syncs to MinIO in the background when connected. Photos taken in the field appear in the Platform's document system automatically.

**4. Project Context**
- Platform: Multi-project. Each project has members and roles.
- Voice Report: No project concept. Everyone is in one big pool.
- Question: Should Voice Report become project-aware? A foreman might work on Project A this month and Project B next month. Their tasks, JSAs, and reports should be scoped to a project.
- Possible approach: Add `project_id` to Voice Report's core tables (people assignments, tasks, JSAs, reports). Default to a single project for now, but the schema supports multiple. When a user logs in, they select their active project (or it's set by their assignment).

**5. API Layer — REST vs GraphQL**
- Platform: Hasura provides GraphQL. Frontend uses GraphQL for most data.
- Voice Report: Pure REST API.
- Question: Should Voice Report expose GraphQL? Should Platform consume Voice Report data via REST or GraphQL?
- Possible approach: Don't change Voice Report's API. Instead, create a sync service that reads from Voice Report's REST API and writes to Platform's PostgreSQL (which Hasura then exposes as GraphQL). The Platform frontend can then query field data through its existing Hasura setup.

**6. The Trade/Hierarchy Gap**
- Platform has NO concept of trades, role hierarchy, or supervisor chains.
- Voice Report has deep trade knowledge: 5 trades, 25 role templates, supervisor hierarchy, trade-specific vocabulary and safety rules.
- Question: Does the Platform need to learn about trades? Or does Voice Report own that domain and Platform just displays the data?
- Possible approach: Voice Report owns the "field operations" domain — trades, hierarchy, tasks, JSAs, safety. Platform owns the "project management" domain — documents, loop folders, project timeline. They share users and project context. Platform shows Voice Report data through embedded views or synced data, but doesn't try to replicate the field logic.

**7. Domain Separation**
- Platform: app.horizonsparks.ai
- Voice Report: voice-report.ai
- Both on the same DGX Spark server
- Question: Are they two separate apps with links between them? Or does the Platform embed Voice Report? Or does Voice Report become a "module" within the Platform?
- Consideration: Field workers need a fast, clean, mobile interface. The Platform is a desktop-first document management tool. Forcing field workers through the Platform UI would be terrible UX. But supervisors need to see both in one place.
- Possible approach: Two separate apps, two domains, but shared authentication and linked navigation. When a superintendent is on the Platform and wants to see field reports, they click through to Voice Report (seamless, no re-login). When a foreman on Voice Report needs to pull up a drawing, they can access it from the Platform. Think of it like Google Docs and Google Sheets — separate tools, same account, linked when needed.

---

## CURRENT STATE SUMMARY

| Aspect | Platform | Voice Report | Integration Need |
|--------|----------|-------------|-----------------|
| Auth | Keycloak (UUID, SSO) | PIN (text ID) | Bridge: Keycloak + PIN unlock |
| Database | PostgreSQL | SQLite | Sync layer or migrate |
| Files | MinIO | Local disk | Sync to MinIO |
| API | Hasura GraphQL + REST | REST only | Sync service |
| Users | UUID, email-based | Text ID, PIN-based | Shared identity |
| Projects | Multi-project | No projects | Add project_id |
| Trades | None | 5 trades, 25 templates | Voice Report owns |
| Hierarchy | Flat (project members) | Deep (5 role levels) | Voice Report owns |
| Tasks | None | Full task system | Voice Report owns |
| JSA/Safety | None | Full JSA system | Voice Report owns |
| Documents | Full doc management | None | Platform owns |
| AI | YOLO (P&ID recognition) | Claude (voice/reasoning) | Both, different purposes |
| Mobile | Not optimized | Mobile-first | Voice Report for field |
| Offline | No | Designed for it | Voice Report stays resilient |

---

## QUESTIONS I NEED HELP ANSWERING

1. Should Voice Report migrate from SQLite to PostgreSQL before deploying to the DGX Spark? Or keep SQLite and build a sync layer?

2. Is the "two apps, shared auth, linked navigation" approach right? Or should we go deeper and make Voice Report a module within the Platform?

3. How should user identity work? Keycloak for everyone but PIN as a quick-unlock? Or keep them separate with a mapping table?

4. What's the right sync strategy? Real-time (webhook/event-driven), periodic (cron), or on-demand (user triggers sync)?

5. Should we add project_id to Voice Report now (before anyone uses it) or later? If now, what's the minimal change?

6. The Platform's PostgreSQL schema uses the `horizonsparks` schema namespace. If Voice Report's data eventually lives in the same PostgreSQL, should it use a separate schema (e.g., `voicereport`) or integrate into `horizonsparks`?

7. For the developer joining next week — what should they focus on? The Platform side (preparing to receive Voice Report data) or the Voice Report side (preparing to send data)?

---

## CONTEXT ABOUT THE TEAM AND TIMELINE

- I (Ellery) am directing both products. I'm not a software developer by training — I'm an electrician with strong critical thinking and big-picture vision.
- I have an AI agent (Claude Code) that has deep understanding of both products, the construction domain, and our architecture. It's my primary development partner.
- Two developers work on the Platform. One is going on vacation for 12 days starting soon.
- Voice Report needs to be deployed to the DGX Spark by Monday with the domain voice-report.ai.
- Shannon will be working on the Instrumentation trade, and another person on Pipe Fitting.
- The goal is for crews to start using Voice Report in the field next week.
- The Platform integration doesn't need to be complete by Monday — but the structural decisions need to be made now so we don't build something that has to be torn apart later.
