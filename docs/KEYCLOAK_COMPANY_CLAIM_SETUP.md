# Keycloak `company_id` Claim Setup

Enables auto-provisioning of new users in Voice Report. Without this
configuration, every Keycloak user that has no matching row in
`voicereport.people` gets HTTP 403 ("User authenticated but not yet
provisioned"). With this configuration, the first valid JWT auto-creates
a `people` row scoped to the right tenant.

The resolver code (`server/middleware/verifyKeycloakJwt.js`) accepts the
company id from **any** of these claim locations, in priority order:

1. `company_id` — direct top-level claim (recommended; simplest)
2. `https://horizonsparks.ai/company_id` — namespaced claim
3. `https://hasura.io/jwt/claims.x-hasura-company-id` — Hasura-style block
4. `groups` array containing `/companies/<id>` — group-based

You only need to set up ONE of these. Below covers the two most useful.

---

## Security model (read this first)

The trustworthiness of the `company_id` claim is determined by **who can
set the underlying attribute or group membership**:

- ✅ **Safe:** the realm admin assigns users to a group, or sets the
  user attribute via the admin UI / API. Users cannot self-edit.
- ❌ **Dangerous:** the attribute is exposed in the registration flow,
  the account console, or any user-editable surface. A malicious user
  could set `company_id=company_acme` and gain worker-level access to
  Acme's data.

If you're not sure, check the User Profile config in Keycloak
(Realm Settings → User Profile) and make sure the attribute is NOT
in the registration/account-console scope.

The application also rejects unknown company ids by checking against
`voicereport.companies` before INSERT, so even with a forged claim a
caller can't pivot to a tenant that doesn't exist. But that's defense
in depth, not the primary control.

---

## Option A — Direct attribute claim (recommended)

### Via Keycloak Admin UI

1. **Add the attribute to the user profile (one-time per realm)**
   - Realm Settings → User Profile → Create attribute
   - Name: `company_id`
   - Display name: "Company"
   - Permissions: **Admin can view/edit: YES, User can view/edit: NO**
   - Required: false (so existing users keep working)

2. **Create a protocol mapper on the `app` client**
   - Clients → `app` → Client scopes → `app-dedicated` → Add mapper → By configuration
   - Choose: **User Attribute**
   - Name: `company_id`
   - User attribute: `company_id`
   - Token claim name: `company_id`
   - Claim JSON type: String
   - Add to ID token: **ON**
   - Add to access token: **ON**
   - Add to userinfo: optional

3. **Populate the attribute for each user**
   - Users → pick user → Attributes tab
   - Add `company_id` = `company_horizon_sparks` (or whichever tenant)
   - Save

4. **Verify**
   - Have the user log in (or refresh their token)
   - Decode their JWT — confirm a top-level `"company_id": "..."` claim
   - Hit any Voice Report API; expect 200 (not 403)

### Via `kcadm.sh` CLI (faster for bulk setup)

```bash
# Authenticate (assumes Keycloak admin user)
kcadm.sh config credentials \
  --server https://keycloak.horizonsparks.ai \
  --realm master \
  --user admin \
  --password "$KEYCLOAK_ADMIN_PASSWORD"

# 1. Add user-attribute mapper to the `app` client
# First find the client uuid + the dedicated client-scope uuid:
APP_CLIENT_ID=$(kcadm.sh get clients -r app -q clientId=app --fields id -F id --format csv --noquotes)
SCOPE_ID=$(kcadm.sh get client-scopes -r app -q name=app-dedicated --fields id -F id --format csv --noquotes)

kcadm.sh create client-scopes/$SCOPE_ID/protocol-mappers/models -r app -b '{
  "name": "company_id",
  "protocol": "openid-connect",
  "protocolMapper": "oidc-usermodel-attribute-mapper",
  "config": {
    "user.attribute": "company_id",
    "claim.name": "company_id",
    "jsonType.label": "String",
    "id.token.claim": "true",
    "access.token.claim": "true",
    "userinfo.token.claim": "true"
  }
}'

# 2. Set the attribute on a specific user (repeat per user)
USER_ID=$(kcadm.sh get users -r app -q username=saxeg --fields id -F id --format csv --noquotes)
kcadm.sh update users/$USER_ID -r app -s 'attributes.company_id=["company_horizon_sparks"]'
```

---

## Option B — Group-based claim

Better for many users / many companies. Lets the admin assign users to
groups and the company id propagates automatically.

1. **Create a group per tenant**
   - Groups → New group → name: `companies/company_horizon_sparks`
     (the `/` creates a nested path, which our resolver parses)
   - Repeat for each tenant.

2. **Add a Group Membership mapper**
   - Clients → `app` → Client scopes → `app-dedicated` → Add mapper
   - Choose: **Group Membership**
   - Name: `groups`
   - Token claim name: `groups`
   - Full group path: **ON** (must be on — resolver needs the `/companies/` prefix)
   - Add to ID + access tokens

3. **Assign users to groups** via Users → user → Groups tab.

The resolver picks up the company id from any group whose path matches
`(?:^|/)companies/([^/]+)` — so `companies/company_horizon_sparks`,
`/companies/company_horizon_sparks`, and
`/tenants/companies/company_horizon_sparks` all work.

---

## Troubleshooting

**Symptom:** still getting 403 after setup.
- Check the JWT contents (`jwt.io` or `jwt-cli`): does the new claim
  appear? If not, the protocol mapper didn't fire — re-check the client
  scope it's attached to.
- Check the Voice Report logs: `docker logs voice-report-app-1 | grep auto-provision` —
  if it says `rejected: unknown company_id`, the claim is present but
  the `voicereport.companies` table doesn't have a row with that id.
  Either create the company first via `POST /api/sparks/companies/onboard`
  or fix the claim value.

**Symptom:** users provisioned but with wrong company.
- The attribute / group was edited self-service by the user. Lock it
  down per the Security Model section above.

**Symptom:** PIN auth still works for these users.
- Auto-provisioned users get a 32-char hex sentinel as their `pin`
  — that's unguessable, so PIN auth correctly fails for them. They
  must always log in via Keycloak SSO.

---

## Related code

- Resolver: `server/middleware/verifyKeycloakJwt.js` (`resolvePersonFromClaims`,
  `extractCompanyId`)
- Migration: `database/migrations/keycloak_auto_provision.sql` (unique index
  on `voicereport.people.keycloak_user_id`)
- Defense-in-depth check: the resolver verifies the company exists in
  `voicereport.companies` before INSERT.
