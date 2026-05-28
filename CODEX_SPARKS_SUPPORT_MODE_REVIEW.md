# Codex Review Request — Sparks Support Mode (Cross-App Iframe)

**Date:** 2026-04-26
**Branches:**
- voice-report: `feature/loopfolders-iframe-panel`
- PIDS-app: `feature/sparks-support-mode`

**Goal:** Sparks support operator sits in Voice Report, chats with a customer on the left pane, flips the right pane between Voice Report view and **LoopFolders (PIDS-app) view** for the SAME company. From the LoopFolders view they can see customer's projects/files/loop-folders AND eventually take fix actions.

This is the FIRST cross-app iframe integration we've ever shipped. Before this, Voice Report and LoopFolders were two separate apps with no UI overlap.

## Architecture summary

```
Voice Report (https://voice-report.ai)
  └── SparksCommandCenter > Company > Support Split
        ├── LEFT: Chat with customer (existing MessagesView)
        └── RIGHT: [Voice Report] [LoopFolders] toggle pills
              ├── 'voicereport' → existing nav tabs + view content (Home/People/Reports/Safety/...)
              └── 'loopfolders' → <LoopFoldersPanel> = <iframe src="https://app.horizonsparks.ai/?support_mode=1&company=X&support_thread=Y" />

PIDS-app (https://app.horizonsparks.ai)
  └── Root Layout
        └── <SparksSupportBanner> — sticky top banner (visible only when ?support_mode=1 + sparks_support role)
        └── <existing app>
```

## Auth model (TODAY — Phase 1)

- VR keeps its existing `hs_session` PIN-based cookie (untouched).
- PIDS-app keeps its existing Keycloak SSO (realm `app`).
- Iframe loads with whatever Keycloak session the browser already has for `app.horizonsparks.ai`. If none, operator sees PIDS login page inside iframe → signs in once → done for the rest of browser session.
- Operator's identity inside PIDS-app comes from THEIR own Keycloak token, NOT impersonation of the customer.

**Phase 2 handoff (out of scope for today):** make VR a Keycloak client for true single-sign-on. Documented in `docs/SPARKS_SUPPORT_MODE.md`.

## Files for review

### voice-report

1. **`docs/SPARKS_SUPPORT_MODE.md`** (NEW) — Architecture doc, URL contract, postMessage protocol, handoff items (Keycloak realm + Hasura permissions for `sparks_support` role).

2. **`client/src/components/LoopFoldersPanel.jsx`** (NEW, ~150 lines) — Iframe wrapper.
   - Builds iframe URL with `?support_mode=1&company=X&support_thread=Y`
   - postMessage listener with origin guard against `ALLOWED_ORIGINS = [PIDS_APP_URL]`
   - Reload + open-in-new-tab buttons
   - Loading state + "sign-in needed" overlay
   - PIDS_APP_URL is hardcoded to `https://app.horizonsparks.ai` — Codex: should this be env-var-driven (`VITE_PIDS_APP_URL`)?

3. **`client/src/views/SparksCommandCenter.jsx`** (MODIFIED) — Three changes:
   a. Import LoopFoldersPanel
   b. New state: `const [rightPaneApp, setRightPaneApp] = useState('voicereport');`
   c. Toggle pills in right header + conditional swap of right-pane content (Voice Report view vs LoopFolders iframe)

### PIDS-app

4. **`docs/SPARKS_SUPPORT_MODE.md`** (NEW, mirror of VR copy) — Same arch doc for PIDS dev team.

5. **`src/components/sparks-support-mode/post-message-bridge.js`** (NEW, ~80 lines) — Bridge to parent window.
   - `SparksSupportBridge.notifyReady() / notifyContext() / notifyAction() / notifyAuthRequired()`
   - Origin guard: only posts when in iframe AND `document.referrer` origin is on `ALLOWED_PARENT_ORIGINS = ['https://voice-report.ai', 'http://localhost:3070', 'https://localhost:3513']`
   - All catches non-empty (ESLint clean)

6. **`src/components/sparks-support-mode/use-support-mode.js`** (NEW, ~70 lines) — Hook.
   - Reads `support_mode`, `company`, `support_thread` from URL via `useSearchParams()`
   - Pulls user role from `useAuthContext()` (same pattern as `use-permissions.jsx`)
   - Returns `{ active, companyId, supportThreadId }` only when ALL of: `support_mode=1`, `company` present, user has `sparks_support` | `admin` | `realm-admin` role.
   - Side effect: calls `bridge.notifyReady()` once active.

7. **`src/components/sparks-support-mode/banner.jsx`** (NEW, ~70 lines) — Sticky top banner.
   - Renders only when `useSparksSupportMode().active` (or shows error chip if forbidden)
   - Visual: warning-colored top strip with company chip + "Exit support" button
   - Exit button posts `sparks-support:exit` to parent

8. **`src/app/layout.jsx`** (MODIFIED) — Two lines:
   - Added import for SparksSupportBanner (placed in custom-components group by line-length sort to satisfy perfectionist)
   - Mounted `<SparksSupportBanner />` inside AuthProvider, above `{children}`

9. **`next.config.mjs`** (MODIFIED) — Added `headers()` returning `Content-Security-Policy: frame-ancestors 'self' https://voice-report.ai http://localhost:3070 https://localhost:3513`. Verified live: `curl -sI http://localhost:3032/` returns the header.

## Specific things I want Codex to check

1. **postMessage origin validation** — Both sides whitelist origins. Is the `document.referrer`-based parent-origin detection in the bridge robust? Browsers strip referrer on cross-origin navigation in some configs (referrer policy). Should we use `window.location.ancestorOrigins[0]` as a backup signal where supported?

2. **CSP completeness** — `frame-ancestors` is set, but should we also set `X-Frame-Options: SAMEORIGIN, https://voice-report.ai` for older browsers? (Note: X-Frame-Options doesn't support multiple origins per spec, so it'd have to be omitted entirely or set to ALLOW-FROM which is deprecated. Probably fine to rely on CSP.)

3. **Iframe sandbox** — Currently NO `sandbox=` attribute on the iframe. Trusted first-party app, but should we explicitly opt-in to `allow-same-origin allow-scripts allow-forms allow-popups` for clarity?

4. **role check** — Hook checks `['sparks_support', 'admin', 'realm-admin']`. Should `pm_admin` (existing role in this codebase) also be allowed? See `src/auth/guard/permission.js` KEYCLOAK_ROLES constants.

5. **Keycloak login redirect inside iframe** — When the iframe boots and operator has no Keycloak session, PIDS-app will redirect the IFRAME (not the parent) to Keycloak's login page. After login Keycloak redirects back. Does the redirect URL contract preserve our `?support_mode=1&company=X` params, or do we lose them and end up on a logged-in-but-no-support-mode page? Likely needs `state` param in OIDC flow.

6. **Concurrent sessions** — Operator can be logged into PIDS-app as themselves (in iframe) AND also be a customer of PIDS-app in another tab as someone else. Does PIDS-app handle this cleanly or do cookies fight?

7. **Audit gap** — Today PIDS-app's write actions (e.g., re-process file) don't post `sparks-support:action` events. We have the bridge plumbed but no call sites yet. Codex: rough list of high-value action call-sites to wire (re-process file, edit tag, delete file, change project owner) — anything I'm missing?

## What's NOT in this PR (handoff items)

1. Keycloak realm config — add `sparks_support` realm role + assign to Tonny/Marian/Laurens/Haroon/Ellery (10 min, requires Keycloak admin UI)
2. Hasura permissions — `sparks_support` role gets cross-company SELECT + scoped INSERT/UPDATE on relevant tables (~1 hour)
3. Action call sites — wire `SparksSupportBridge.notifyAction()` into actual write endpoints in PIDS-app
4. Phase 2 SSO — VR as Keycloak client (multi-day; for true zero-prompt iframe sign-in)

## Test plan (post Codex)

1. Sign into VR as Sparks user, open a company → Support Split
2. Toggle right pane to "LoopFolders" → iframe loads
3. If Keycloak session exists in browser → PIDS-app loads, banner shows "Sparks Support Mode · Company: X"
4. If no Keycloak session → PIDS login screen inside iframe → sign in → step 3
5. Take a fix action in PIDS-app → check `postMessage` log in browser console (Phase 4 audit log wire-up to come)
