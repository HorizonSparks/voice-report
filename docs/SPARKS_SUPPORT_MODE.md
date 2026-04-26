# Sparks Support Mode — Cross-App Operator Workstation

**Status:** Phase 1 scaffold (2026-04-26). Iframe loads, banner renders, URL contract stable. Real Keycloak role + Hasura permission setup is a **handoff item** for the dev team.

## Goal

A Sparks support operator (Tonny, Marian, Laurens, Haroon) sits in Voice Report. They open a customer's company detail and start chatting with someone (left pane). On the right pane, they can flip between **Voice Report** view (existing) and **LoopFolders** view (new) for the same company. From the LoopFolders view they can see the customer's projects, P&IDs, files, loop folders — and eventually take fix actions.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Voice Report (https://voice-report.ai)                      │
│  ┌──────────────────┬──────────────────────────────────────┐│
│  │  Chat with Mike  │  ┌────────────────────────────────┐  ││
│  │  (MessagesView)  │  │ [Voice Report] [LoopFolders]   │  ││
│  │                  │  ├────────────────────────────────┤  ││
│  │                  │  │ <iframe                         │  ││
│  │                  │  │   src=https://app.horizonsparks │  ││
│  │                  │  │       .ai/?support_mode=1       │  ││
│  │                  │  │       &company=summit-electric  │  ││
│  │                  │  │   />                            │  ││
│  │                  │  └────────────────────────────────┘  ││
│  └──────────────────┴──────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
            ▲ same browser, two app sessions
            │
            ├── VR session: hs_session cookie (PIN-based, today)
            └── PIDS-app session: Keycloak SSO (today)
```

## URL contract (PIDS-app reads these)

| Param | Required | Meaning |
|---|---|---|
| `support_mode` | `1` to enable | Tells PIDS-app to render the support banner + lock to the company filter |
| `company` | yes when support_mode=1 | Company ID/slug to scope the project list |
| `support_thread` | optional | Voice Report support_conversations.id — if present, PIDS-app can postMessage operator actions back tagged to this thread |

Example: `https://app.horizonsparks.ai/?support_mode=1&company=summit-electric&support_thread=conv_abc123`

## Auth model (TODAY)

**Two separate sessions.** VR keeps its hs_session cookie. PIDS-app uses Keycloak. The iframe loads with whatever Keycloak session the browser already has. If none, the iframe shows the PIDS-app login screen — operator signs in once, browser remembers.

This means **the operator may have to sign into PIDS-app the first time per browser session**. That's acceptable for Phase 1 because:
- Operators are Sparks staff with Keycloak accounts
- The session persists for the rest of the day
- Real per-action audit goes through Keycloak (who did what, when)

## Auth model (PHASE 2 HANDOFF — single sign-on)

Long term, we want one login. Path:
1. Add `voice-report` client to Keycloak realm `app`
2. Add Keycloak login flow to VR alongside existing PIN auth (don't break PIN — Sparks people use PIN for daily ops, Keycloak for cross-app)
3. When operator logs into VR via Keycloak → VR mints hs_session AND Keycloak sets first-party cookie on `keycloak.horizonsparks.ai`
4. Iframe to PIDS-app inherits the Keycloak session — zero additional prompts
5. Same Keycloak `sub` shared between both apps → unified audit

**Blocker today:** VR is on `voice-report.ai` (different root domain from `*.horizonsparks.ai`). For first-party Keycloak cookies to flow into iframe, both apps need to share a parent domain. Recommend: move VR to `voice-report.horizonsparks.ai` OR keep separate roots and rely on Keycloak SSO redirect-on-each-tab (Phase 2 still works, just one extra redirect on first iframe load).

## Role model

PIDS-app already does role-based authorization via Keycloak `realm_access.roles`. We need a new role:

```
sparks_support
```

Granted to: Tonny (4444), Marian (5555), Laurens (6666), Haroon (7777), and Ellery (admin).

PIDS-app changes (handoff):
- Hasura row-level permissions: `sparks_support` role gets cross-company SELECT on projects, files, loop_folders, etc.
- PIDS-app frontend: when `sparks_support` role + `support_mode=1` URL param → show banner, scope project list to `?company=X`
- All write actions still gated by Keycloak per-action permission checks (operator's own role decides what they can fix)

## CSP / iframe headers

PIDS-app needs to allow Voice Report as a frame ancestor. Add to `next.config.mjs` headers:

```js
headers: [
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'self' https://voice-report.ai",
  },
],
```

Without this header browsers ignore the iframe by default (X-Frame-Options DENY/SAMEORIGIN behavior). With it, only voice-report.ai (and PIDS itself) can frame PIDS-app — defense against clickjacking.

## postMessage protocol (Phase 4)

Two-way channel between iframe (PIDS-app) and parent (Voice Report).

**Iframe → Parent** (PIDS-app posts to VR):
```json
{ "type": "sparks-support:context", "file_id": "...", "loop_folder": "..." }
{ "type": "sparks-support:action", "action": "reprocess_file", "file_id": "...", "actor": "<keycloak_sub>" }
```

**Parent → Iframe** (VR posts to PIDS-app):
```json
{ "type": "sparks-support:customer-message", "text": "..." }
{ "type": "sparks-support:focus-file", "file_id": "..." }
```

VR uses `sparks-support:action` events to write a system message to the support_conversations thread ("Operator re-processed file XYZ at 14:32"), giving the customer a transparent audit trail.

## Files in this PR (voice-report)

- `docs/SPARKS_SUPPORT_MODE.md` — this file
- `client/src/components/LoopFoldersPanel.jsx` — iframe wrapper component
- `client/src/views/SparksCommandCenter.jsx` — toggle integration

## Files in companion PR (PIDS-app feature/sparks-support-mode)

- `docs/SPARKS_SUPPORT_MODE.md` — same doc, mirror copy for PIDS dev team
- `src/components/sparks-support-mode/banner.jsx` — top banner shown when ?support_mode=1
- `src/components/sparks-support-mode/use-support-mode.js` — URL param hook
- `src/components/sparks-support-mode/post-message-bridge.js` — postMessage emitter
- `next.config.mjs` — CSP frame-ancestors header
- `src/middleware.js` — read URL params + inject support_mode flag (if needed)

## Handoff to dev team

After Codex review + Ellery smoke test, the work that requires Keycloak/Hasura admin rights:

1. **Keycloak realm config (10 min):**
   - Realm `app` → Roles → add realm role `sparks_support`
   - Assign to user accounts: tonny, marian, laurens, haroon, ellery
2. **Hasura permissions (~1 hour):**
   - Add `sparks_support` role
   - Permissions: SELECT on `projects`, `files`, `loop_folders`, `tags`, `comments` with no row filter (cross-company)
   - INSERT/UPDATE/DELETE: scope per business rules (e.g., re-process file = yes, change billing = no)
3. **Test flow:**
   - Sign into VR as Sparks user
   - Open Summit Electrical → Support split → flip right pane to LoopFolders
   - Iframe should show Summit Electrical's projects only
   - Try a fix action (re-process a file) — confirm it lands in audit
4. **Phase 2 (optional, true SSO):** add VR as Keycloak client (see Auth model section)

## Open questions for dev team

1. Should the Sparks operator's actions inside the iframe show up to the customer as system messages in their support thread? (My read: yes — transparency. postMessage protocol enables this.)
2. Are there LoopFolders actions that should be **forbidden** in support mode? (e.g., delete project, change owner.) Need a denylist.
3. iframe load time on cold Keycloak session — is the one-time login UX acceptable or do we need to push Phase 2 SSO forward?

## Codex review remediations (2026-04-26)

Codex pass on the Phase 1 scaffold surfaced 7 findings. Status:

| Sev | Finding | Fix |
|---|---|---|
| Critical | `auth-guard.jsx` stored `returnTo` as pathname only — `?support_mode=1&company=X&support_thread=Y` was lost across the login round-trip | `createRedirectPath()` now reads `window.location.search + hash` and includes them in `returnTo`. `safeReturnUrl` in `guest-guard.jsx` already preserves `pathname + search + hash` for same-origin URLs, so the round-trip works end-to-end. |
| High | postMessage bridge derived parent origin only from `document.referrer` — fragile under `Referrer-Policy: no-referrer` and after in-iframe navigation | Bridge now prefers `window.location.ancestorOrigins[0]` (Chromium + WebKit, immutable, browser-set), falls back to `document.referrer`, caches the result at module load. Refuses to post when neither source resolves to an allowlisted origin. |
| High | Concurrent-identity localStorage conflict | See [Concurrent identity](#concurrent-identity-phase-1-caveat) below. Documented; no code change in Phase 1. |
| Medium | Bridge conflated `auth-required` (no Keycloak session) with `forbidden` (session present, role missing) — parent showed wrong copy | New `notifyForbidden()` event. Hook now distinguishes: no session → `notifyAuthRequired()`; session + missing role → `notifyForbidden('role-missing')`. Banner has 4 visual states (active, forbidden, auth-required, missing-company). |
| Medium | `pm_admin` (project manager) was not on the support roles allowlist; PMs can already do project-level fixes from the inbox | Added `pm_admin` to `SUPPORT_ROLES`. |
| Low | Iframe missing `sandbox` attribute | Skipped — sandbox would break Keycloak login redirects (cross-origin form submission). Revisit when Phase 2 SSO removes the need for in-iframe Keycloak. |
| Low | Audit gap on write actions | `notifyAction()` exists in the bridge but no call sites yet. Wire-up tracked in §"Phase 4 — postMessage protocol" below. |

### Concurrent identity (Phase 1 caveat)

**The problem.** PIDS-app stores its Keycloak access token in `localStorage` (key `accessToken`) on origin `app.horizonsparks.ai`. localStorage is per-origin, not per-tab. So if a Sparks operator:

- Has tab A: their own PIDS-app session at `https://app.horizonsparks.ai`
- Opens tab B: Voice Report at `https://voice-report.ai` and toggles the LoopFolders iframe (which loads `https://app.horizonsparks.ai/?support_mode=1&company=X`)

…both tabs share the same `accessToken` in localStorage. There is **only one identity** per origin per browser session.

**Why it's fine in Phase 1.** The operator IS themselves in support mode. They use their own `sparks_support` / `pm_admin` role. They are not "impersonating" the customer — they're acting on the customer's data with their own Sparks-staff identity. Both tabs see the same operator JWT, which is the correct behavior.

**Why it would break in Phase 2 (impersonation).** If we ever add "impersonate as customer" (operator's actions logged as the customer's user_id, not the operator's) we'd need a per-tab token. localStorage can't do that.

**Phase 2 mitigations to consider:**
- Use `sessionStorage` instead of `localStorage` for the iframe's token (per-tab) — requires forking the auth context for support mode
- Encode the impersonation in the JWT itself via Keycloak token-exchange; backend audit reads `act.sub` (acting party) separately from `sub` (subject) — no client-side token swap needed
- Recommended: the second option. It pushes the audit to the server and avoids breaking other PIDS-app tabs.

For now, **Phase 1 ships without impersonation**, the localStorage sharing is a non-issue, and this section exists so future-us doesn't try to bolt on impersonation without re-reading it.
