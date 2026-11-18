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

Consequences for operations:

- **Reseller suspension depends on the trigger.** The API no longer revokes refresh tokens itself when it suspends a reseller (`resellers_revoke_sessions` does). Deploying the API before the migration would let a suspended reseller's staff keep refreshing their sessions.
- **The system reseller cannot be suspended, deactivated or deleted, even by the database owner.** A maintenance script that tries will fail with `check_violation`. This is intended (ROV-102).
- **A refresh token can be inserted only for an active membership.** Data imports that create `refresh_tokens` rows directly will be refused for memberships that do not exist or are not active.

The full list of database-enforced rules and the tests that prove them is in `docs/testing.md` → "Security invariants".

## Redis

Redis is on the request path for access control, not only for caching:

- `ResellerAccessGuard` (ROV-97) reads `auth:reseller-access:<id>` on every reseller-scope request, and suspension writes a block marker there. If Redis is unreachable these requests fail rather than skip the check.
- `ImpersonationSessionGuard` reads `impersonation-session:<id>` and its tombstone on every impersonated request.
- One-time impersonation codes, impersonation OTP requests and ws-tickets live only in Redis.

Plan Redis availability with that in mind; a Redis outage blocks reseller users and impersonation.

## Impersonation OTP delivery

Reseller impersonation (and platform impersonation into an institute that requires consent) sends a 6-digit code to the institute admin's primary phone through the notification service (`NOTIFICATION.auth.security`). An institute whose admin has no primary phone cannot be impersonated by a reseller: the request is refused with `IMPERSONATION_CONSENT_UNAVAILABLE`. Make sure institute admins have a primary phone on file, and that the notification service's SMS channel is configured.
