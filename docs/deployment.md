# Production deployment

What a production deploy of Roviq needs beyond running the containers. Each section names the change that introduced the requirement, so a reader can trace why it exists. Add to this file whenever a change needs something from production that development does not.

## Hosts

The single web app serves all three portals and picks the portal from the host name (`apps/web/src/middleware.ts`):

| Portal | Host |
|---|---|
| Platform admin | `admin.roviq.com` |
| Reseller | `reseller.roviq.com` |
| Institute | `app.roviq.com` |

Any host whose first label is not `admin` or `reseller` is served as the institute portal.

## Web app environment

`NEXT_PUBLIC_*` values are compiled into the browser bundle, so they must be set when the web image is **built**, not only when it runs.

| Variable | Production value | Why |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | the public API origin | Every browser request goes here. |
| `NEXT_PUBLIC_INSTITUTE_URL` | `https://app.roviq.com` | ROV-101. Admin and reseller impersonation opens the institute portal in a new tab at this origin. When unset, the origin is derived by dropping `admin.`/`reseller.` from the current host, which gives `roviq.com`, not `app.roviq.com`, so impersonation would open the wrong site. |

## Database migrations

Run `pnpm db:migrate` (Drizzle `migrate`, connecting with `DATABASE_URL_MIGRATE`, the `roviq` owner role) **before** the new API version takes traffic. Several security rules now live in the database, and the API relies on them being there:

| Migration | Effect |
|---|---|
| `*_rov-290-institute-group-reseller-owner` | Adds `institute_groups.reseller_id` and the reseller read policy. |
| `*_rov-290-institute-admin-abilities-backfill` | Rewrites default `institute_admin` roles that still hold bare `manage all`. Roles an institute customised are left alone. |
| `*_rov-102-db-level-auth-invariants` | Tightens policies on `impersonation_sessions` and `institutes`; adds `chk_refresh_token_revoked_reason`. Before adding the constraint it sets `revoked_reason = 'rotation'` on revoked tokens that have none, which is how the API already treated them. |
| `*_rov-102-auth-invariant-triggers` | The triggers that revoke staff sessions when a reseller is suspended, revoke a user's sessions when the password changes, protect the system reseller, and restrict institute deletion to the platform. |
| `*_rov-101-reseller-full-admin-reads-users` | Adds `read User` to every stored `reseller_full_admin` role, so reseller admins can list an institute's users. |
| `*_rov-185-reseller-team-sessions-and-abilities` | Adds the `reseller_memberships_revoke_sessions` trigger (a deactivated or deleted team member loses their refresh tokens and reseller impersonation sessions) and `manage ResellerTeam` on every stored `reseller_full_admin` and `reseller_support_admin` role. |
| `*_rov-186-reseller-self-update` | Lets a reseller edit its own record: the `reseller_own_update` policy, an `UPDATE` grant to `roviq_reseller` on the settings columns only (`name`, `branding`, `registration_number`, `registration_state`, `contact`, `address` and the audit columns), and `read`/`update Reseller` on every stored `reseller_full_admin` role. |

Consequences for operations:

- **Reseller suspension depends on the trigger.** The API no longer revokes refresh tokens itself when it suspends a reseller (`resellers_revoke_sessions` does). Deploying the API before the migration would let a suspended reseller's staff keep refreshing their sessions.
- **The system reseller cannot be suspended, deactivated or deleted, even by the database owner.** A maintenance script that tries will fail with `check_violation`. This is intended (ROV-102).
- **Deactivating a reseller team member depends on the trigger.** `resellerDeactivateTeamMember` only flips `is_active`; `reseller_memberships_revoke_sessions` ends the sessions. Until the migration runs, the Team page also answers `FORBIDDEN` for every change, because the stored roles lack `manage ResellerTeam` (cached per role for 5 minutes in `casl:role:<id>`).
- **Reseller settings depend on the grant.** Until `*_rov-186-reseller-self-update` runs, `resellerUpdateProfile` and `resellerUpdateBranding` answer `FORBIDDEN` (the stored role lacks `update Reseller`, cached for 5 minutes in `casl:role:<id>`), and would fail with `permission denied` even with the ability.
- **A refresh token can be inserted only for an active membership.** Data imports that create `refresh_tokens` rows directly will be refused for memberships that do not exist or are not active.

The full list of database-enforced rules and the tests that prove them is in `docs/testing.md` → "Security invariants".

## Redis

Redis is on the request path for access control, not only for caching:

- `ResellerAccessGuard` (ROV-97) reads `auth:reseller-access:<id>` on every reseller-scope request, and suspension writes a block marker there. If Redis is unreachable these requests fail rather than skip the check.
- The same guard reads `auth:reseller-member-access:<membershipId>` (ROV-185). A role change, a deactivation and a tier change write the role the member's tokens must carry (or `blocked`) there for 11 minutes, one minute longer than a reseller access token lives. If the key is lost early, a token issued before the change keeps its old role until it expires (at most 10 minutes); refresh tokens are unaffected because the database checks the membership.
- `ImpersonationSessionGuard` reads `impersonation-session:<id>` and its tombstone on every impersonated request.
- One-time impersonation codes, impersonation OTP requests and ws-tickets live only in Redis.

Plan Redis availability with that in mind; a Redis outage blocks reseller users and impersonation.

## Impersonation OTP delivery

Reseller impersonation (and platform impersonation into an institute that requires consent) sends a 6-digit code to the institute admin's primary phone through the notification service (`NOTIFICATION.auth.security`). An institute whose admin has no primary phone cannot be impersonated by a reseller: the request is refused with `IMPERSONATION_CONSENT_UNAVAILABLE`. Make sure institute admins have a primary phone on file, and that the notification service's SMS channel is configured.
