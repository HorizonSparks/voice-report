# Voice Report ↔ LoopFolders shared Keycloak SSO — handoff (2026-05-02)

Backend SSO infrastructure is **deployed and live** on `voice-report.ai`. Three actions complete the "one shared login" UX. Each is independent — do them in any order; partial completion still leaves the system in a working state.

---

## Action 1 — Keycloak admin (you, ~5 min)

You need a confidential OIDC client whose tokens Voice Report will accept. **Easiest path: reuse the existing `app` client** (already used by LoopFolders/PIDS-app); just add VR's redirect URLs.

1. Open Keycloak admin: https://keycloak.horizonsparks.ai/admin/master/console/
2. Switch to realm: **app**
3. Clients → **app** → Settings tab
4. **Valid Redirect URIs** — add these:
   - `https://voice-report.ai/auth/sso/callback`
   - `https://horizonsparks.ai/auth/sso/callback`
   - `https://app.horizonsparks.ai/auth/sso/callback` *(future, if VR moves there)*
5. **Web Origins** — add the same hosts (for CORS), or use `+` to inherit from redirect URIs
6. **Credentials tab** — copy the **Client Secret**
7. SSH to Spark, append to `.env`:
   ```
   KEYCLOAK_OIDC_CLIENT_SECRET=<paste-client-secret-here>
   ```
8. Restart Voice Report:
   ```
   cd ~/voice-report && docker compose up -d app
   ```

After this: `https://voice-report.ai/auth/sso/login` will redirect users through Keycloak. They get back signed in. **One login, two apps, end-to-end working.**

Verify with: `curl -sk -o /dev/null -w 'HTTP %{http_code}\n' https://voice-report.ai/auth/sso/login` — should now redirect (302), not 503.

---

## Action 2 — Map team Keycloak UUIDs to people rows (you, ~10 min)

Tonight's schema added `voicereport.people.keycloak_user_id` (nullable). Until populated, JWT-authenticated requests for that user return 403 "User authenticated but not yet provisioned." Map your team:

```sql
-- Replace UUIDs with the actual Keycloak realm-app user UUIDs.
-- Find them: Keycloak admin → realm app → Users → click name → Details → Id.

UPDATE voicereport.people SET keycloak_user_id = '<uuid-from-keycloak>',
                              keycloak_username = 'ellery'
WHERE id = 'person_ellery_vargas';

UPDATE voicereport.people SET keycloak_user_id = '<uuid-from-keycloak>',
                              keycloak_username = 'shannon'
WHERE id = 'person_shannon';

UPDATE voicereport.people SET keycloak_user_id = '<uuid-from-keycloak>',
                              keycloak_username = 'anthony'
WHERE id = 'person_anthony';

UPDATE voicereport.people SET keycloak_user_id = '<uuid-from-keycloak>',
                              keycloak_username = 'ender'
WHERE id = 'person_ender';

UPDATE voicereport.people SET keycloak_user_id = '<uuid-from-keycloak>',
                              keycloak_username = 'rabia'
WHERE id = 'person_rabia';

UPDATE voicereport.people SET keycloak_user_id = '<uuid-from-keycloak>',
                              keycloak_username = 'tommy'
WHERE id = 'person_tommy_guerrero';
```

Run via:
```
docker exec -i voice-report-postgres-1 psql -U horizon_spark -d horizon < team_mapping.sql
```

Customer users: don't bulk-map. The middleware lazy-maps them on first JWT login (if they exist by username, it backfills the UUID automatically).

---

## Action 3 — PIDS-app proxy: forward Keycloak Bearer to VR (Anthony, ~10 min)

File: `~/Documents/PIDS-app/src/app/api/sparks-ai/chat/route.js` on Spark.

Today: `vrHeaders = { 'X-Integration-Key': INTEGRATION_KEY };`

Change to forward the user's Keycloak access token alongside the integration key:

```js
async function proxyToVoiceReport(request) {
  const contentType = request.headers.get('content-type') || '';
  let vrBody;

  // Forward the user's Keycloak access token so VR can verify identity.
  // Falls back to integration-key-only auth if the request has no Bearer
  // (e.g. server-side internal calls during build).
  const incomingAuth = request.headers.get('authorization');
  const vrHeaders = { 'X-Integration-Key': INTEGRATION_KEY };
  if (incomingAuth && incomingAuth.toLowerCase().startsWith('bearer ')) {
    vrHeaders['Authorization'] = incomingAuth;
  }

  // ... rest of existing function unchanged
```

Also: client-side fetches in `loopfolders/sparks-ai-chat.jsx` (or wherever this proxy is called) need to include the access token. Anthony will know the right plumbing — typically the auth context has `accessToken` and we add `Authorization: 'Bearer ' + accessToken` to the fetch headers.

---

## What's deployed live tonight (2026-05-02)

**Voice Report on `voice-report.ai`:**
- ✅ Keycloak JWT verification middleware (`server/middleware/verifyKeycloakJwt.js`) — verifies signature against JWKS, resolves person via `keycloak_user_id` or `keycloak_username` lookup, falls back gracefully to integration-key path when no Bearer header
- ✅ SSO routes (`server/routes/sso.js`) — `/auth/sso/login`, `/auth/sso/callback`, `/auth/sso/logout` with PKCE
- ✅ Schema migration: `voicereport.people.keycloak_user_id`, `voicereport.people.keycloak_username`, `voicereport.companies.pids_project_id` (all nullable, indexed, idempotent)
- ✅ Configurable `COOKIE_DOMAIN` env (set to `.horizonsparks.ai` once DNS unifies)
- ✅ `validateEnv` boot-time gate — Keycloak issuer/audience/client_id are now REQUIRED; client secret + cookie domain are RECOMMENDED warnings
- ✅ `jose` 5.10.0 installed
- ✅ docker-compose.yml passes Keycloak envs to container
- ✅ All previous fixes from 2026-05-01 still intact (dead file deleted, /api/* 404 JSON, hardcoded DB password removed from source, iframe sandbox)

**Backups on Spark `/tmp/`:**
- `package.json.bak.20260502_0027`
- `server_index.js.bak2.20260502_0030`
- `sessionAuth.js.bak.20260502_0035`
- `docker-compose.yml.bak.20260502_0035`
- `vr_backup_20260502/voicereport_schema_pre_keycloak.sql.gz` (15M, full schema dump)

**Smoke test results (live):**
- Homepage: 200
- Unknown `/api/*`: JSON 404 ✓
- Bad Bearer token: 401 "Invalid or expired token" ✓ (JWT middleware alive)
- `/auth/sso/login` without secret: 503 with `missing: ["KEYCLOAK_OIDC_CLIENT_SECRET"]` ✓ (gracefully reports needed config)
- Integration key path: still works for cross-app calls ✓

---

## Cookie domain decision (when DNS flips)

Once both apps live on `.horizonsparks.ai` (Ellery's chosen apex):

```
# .env on Spark
COOKIE_DOMAIN=.horizonsparks.ai
```

Restart. After this, `hs_session` cookie set on `app.horizonsparks.ai` is sent automatically to `voice-report.horizonsparks.ai` (or wherever VR moves), and vice versa. **One session, both apps, no cross-domain handoff needed.**

If you go with path-based routing (Option A from chat — `app.horizonsparks.ai/` for VR + `app.horizonsparks.ai/pid/*` for PIDS-app), you don't even need `COOKIE_DOMAIN` because both apps are on the exact same host. Set it anyway for safety / future flexibility.

---

## What still needs Ender's eyes (post-Monday code review)

1. **Integration key path is still trusted.** Once all VR clients (PIDS-app, others) forward Bearer tokens, we should consider removing the integration-key auth path entirely. Today it's still active as a fallback.
2. **The hardcoded DB password is still in `docker-compose.yml`** (`${PG_PASSWORD:-8oS4...}` line ~33 and ~41). Source-tree fallbacks were cleaned 2026-05-01 but compose still has it. Same risk class fix.
3. **PIN auth flow vs Keycloak.** Today both work. Eventually PIN flow should become a Keycloak credential type (custom auth flow) so there's truly one identity store. Not blocking launch.
4. **PIDS-app's frontend** still inlines `NEXT_PUBLIC_INTEGRATION_KEY` per audit memory. Should be killed now that JWT flow exists.

---

## Retiring voice-report.ai (Ellery's call 2026-05-02)

### Decision needed first
Pick where Voice Report lives going forward:
- **Option 1**: `app.horizonsparks.ai` (replaces PIDS-app frontend; PIDS-app moves to `pid.horizonsparks.ai`)
- **Option 2**: `app.horizonsparks.ai/` for VR + `app.horizonsparks.ai/pid/*` for PIDS-app (path-based routing)
- **Option 3**: `vr.horizonsparks.ai` (its own subdomain; `app.horizonsparks.ai` stays PIDS-app)

Once chosen, replace `<NEW_VR_HOST>` below.

### Steps (you)

**A. Cloudflare Tunnel (`/etc/cloudflared/config.yml`)**:
   - Add ingress rule for `<NEW_VR_HOST>` → `http://localhost:3070` (or 3513 for HTTPS)
   - Either delete the `voice-report.ai` rule, or change its service to `https://<NEW_VR_HOST>` (so Cloudflare 301-redirects bookmarks)
   - Restart cloudflared: `systemctl restart cloudflared`

**B. Cloudflare DNS dashboard**:
   - For `voice-report.ai` zone: change root + www records to a "Page Rule" or Worker that 301-redirects to `https://<NEW_VR_HOST>$1`
   - OR just delete the zone (cleaner; bookmarks fail with DNS error, which signals retirement clearly)

**C. Keycloak admin (realm `app` → client `app`)**:
   - Add `https://<NEW_VR_HOST>/auth/sso/callback` to Valid Redirect URIs
   - Remove `https://voice-report.ai/auth/sso/callback` (after verifying new host works)
   - Update "Web Origins" similarly

**D. PIDS-app .env (Anthony or you)**:
   ```
   NEXT_PUBLIC_VOICE_REPORT_URL=https://<NEW_VR_HOST>
   VOICE_REPORT_URL=https://<NEW_VR_HOST>
   ```
   Then redeploy PIDS-app.

**E. Voice Report .env (you)**:
   ```
   PUBLIC_BASE_URL=https://<NEW_VR_HOST>
   COOKIE_DOMAIN=.horizonsparks.ai
   ```
   Restart VR container.

### Testing after retirement
- `curl -I https://voice-report.ai` → expect 301 (if redirect set) or DNS error (if zone deleted)
- `curl -sk -o /dev/null -w '%{http_code}' https://<NEW_VR_HOST>/` → 200
- `curl -I https://<NEW_VR_HOST>/auth/sso/login` → 302 (with Location header to Keycloak)
- Browser smoke: log in via SSO, click Sparks Support Mode iframe panel, confirm session persists into PIDS-app inside the iframe (cookie-domain test)

