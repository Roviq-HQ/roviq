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
| `*_rov-186-reseller-branding-files` | Adds the file purposes `RESELLER_LOGO` and `RESELLER_FAVICON`, `resellers.logo_file_id` / `favicon_file_id`, the reseller write policies on `files` with `INSERT, UPDATE` for `roviq_reseller`, and removes typed `logoUrl` / `faviconUrl` from `resellers.branding`. A logo that was typed as a URL is gone after this migration and must be uploaded. |
| `*_rov-195-drop-branding-urls`, `*_rov-195-branding-files` | Drops the typed URL columns (`institute_branding.logo_url` / `favicon_url` / `cover_image_url`, `institute_group_branding.logo_url` / `favicon_url`, `institutes.logo_url`) and adds file references in their place, with the purposes `INSTITUTE_LOGO`, `INSTITUTE_FAVICON` and `INSTITUTE_COVER`. An institute logo that was typed as a URL is gone after these migrations and must be uploaded. |
| `*_rov-291-payment-gateway-ids` | Adds an index on `payments.gateway_order_id` and a unique index on `payments.gateway_payment_id` (where not null). It fails if two payment rows already share a gateway payment id; find them with `SELECT gateway_payment_id FROM payments WHERE gateway_payment_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1` and resolve them first. |

Consequences for operations:

- **Reseller suspension depends on the trigger.** The API no longer revokes refresh tokens itself when it suspends a reseller (`resellers_revoke_sessions` does). Deploying the API before the migration would let a suspended reseller's staff keep refreshing their sessions.
- **The system reseller cannot be suspended, deactivated or deleted, even by the database owner.** A maintenance script that tries will fail with `check_violation`. This is intended (ROV-102).
- **Deactivating a reseller team member depends on the trigger.** `resellerDeactivateTeamMember` only flips `is_active`; `reseller_memberships_revoke_sessions` ends the sessions. Until the migration runs, the Team page also answers `FORBIDDEN` for every change, because the stored roles lack `manage ResellerTeam` (cached per role for 5 minutes in `casl:role:<id>`).
- **Reseller settings depend on the grant.** Until `*_rov-186-reseller-self-update` runs, `resellerUpdateProfile` and `resellerUpdateBranding` answer `FORBIDDEN` (the stored role lacks `update Reseller`, cached for 5 minutes in `casl:role:<id>`), and would fail with `permission denied` even with the ability.
- **Leave rules take effect up to 5 minutes after the migration.** `*_rov-304-leave-ability-conditions` and `*_rov-304-leave-withdraw-and-guardian-apply` rewrite the stored leave rules of the system roles. Role rules are cached for 5 minutes in `casl:role:<id>` and a migration does not clear that cache, so the older, wider rules stay in force until it expires. Delete the `casl:role:*` keys right after any migration that narrows a role.
- **Online invoice payment needs the gateway's checkout domains.** The institute portal loads `https://checkout.razorpay.com/v1/checkout.js` or `https://sdk.cashfree.com/js/v3/cashfree.js` in the browser; a Content-Security-Policy must allow them. Cashfree production also requires the institute portal domain to be whitelisted in the Cashfree dashboard, and its return URL is derived from the origin of `BILLING_RETURN_URL`.
- **A refresh token can be inserted only for an active membership.** Data imports that create `refresh_tokens` rows directly will be refused for memberships that do not exist or are not active.

The full list of database-enforced rules and the tests that prove them is in `docs/testing.md` → "Security invariants".

## Object storage

The gateway needs an S3-compatible store and all eight `S3_*` variables (see `.env.example`);
it refuses to start without them. Production uses a managed service: **AWS S3 or Cloudflare R2**
(not decided as of 2026-11-19). Dev and CI use RustFS. Buckets are created by infrastructure,
never by the app.

Before pointing an environment at a provider, create both buckets, set the variables and run
`pnpm storage:check`. It must pass in full; it is the test of whether a provider is usable.

Required on any provider:

- **Two buckets**: `S3_BUCKET_PRIVATE` with all public access blocked, and `S3_BUCKET_PUBLIC`
  readable without sign-in (objects only, no listing). The public bucket holds branding and
  nothing else.
- **`S3_PUBLIC_ENDPOINT`** must be the address browsers reach, because presigned URLs are signed
  for that host. **`S3_PUBLIC_BASE_URL`** is the public bucket's base URL; put a CDN there.
- **CORS** on the private bucket: allow `PUT` and `GET` from the three portal origins only, with
  the `Content-Type` request header. Without it every browser upload fails, while server-side
  tests still pass. `scripts/storage-init.ts` shows the exact rule used in dev.
- **Separate origin**: serve storage from a domain that is not a portal domain, so an uploaded
  file can never run script in a portal's origin.
- **Encryption at rest** and TLS only.
- **Lifecycle**: abort incomplete multipart uploads after one day. Do not enable versioning
  without a plan for erasure requests, which must remove every version.
- **Backups**: replicate or back up the private bucket; the database alone cannot restore files.
- **Credentials**: an access key limited to these two buckets (get, put, delete, list, copy).
- `/api/health` reports storage down when either bucket is missing or unreachable.

Provider notes:

| | AWS S3 | Cloudflare R2 |
|---|---|---|
| `S3_REGION` | `ap-south-1` (Mumbai) | `auto` |
| `S3_ENDPOINT` / `S3_PUBLIC_ENDPOINT` | `https://s3.ap-south-1.amazonaws.com` | `https://<account-id>.r2.cloudflarestorage.com` |
| Public bucket | bucket policy allowing `s3:GetObject` to everyone, behind CloudFront | no bucket policies: connect a custom domain to the bucket (public access) |
| `S3_PUBLIC_BASE_URL` | the CloudFront domain | the custom domain |
| Data location | stays in the Mumbai region | pick the location or jurisdiction when creating the bucket; confirm it meets the data-residency position for student records before choosing R2 |
| Cost shape | storage plus per-GB download fees | lower storage price, no download fees |

The R2 column is from Cloudflare's documentation and has not been run against this codebase.
`pnpm storage:check` decides: in particular it proves that a presigned upload is refused when the
body's size or type differs from what was signed, which the upload design depends on.

## Background workers

Temporal workers run inside the api-gateway process, switched on per instance with a
`*_WORKER_ENABLED=true` variable. Set each flag on exactly the gateway instances that should run
that worker; every instance needs `TEMPORAL_ADDRESS` to reach Temporal.

- **`FILE_SWEEPER_WORKER_ENABLED`** (ROV-300): the hourly file sweeper (`docs/architecture.md` →
  "File sweeper"). It creates the `file-sweeper-hourly` schedule at start if Temporal does not
  have it, so it needs Temporal reachable at start; the schedule skips a run while the previous
  one is still going, so more than one instance is safe but wasteful. Without any instance
  running it, stale uploads and deleted files are never removed from storage. The storage
  access key needs delete rights on both buckets (already in the list under "Object storage").
  It connects with `DATABASE_URL` and runs its queries as `roviq_admin`.

## Redis

Redis is on the request path for access control, not only for caching:

- `ResellerAccessGuard` (ROV-97) reads `auth:reseller-access:<id>` on every reseller-scope request, and suspension writes a block marker there. If Redis is unreachable these requests fail rather than skip the check.
- The same guard reads `auth:reseller-member-access:<membershipId>` (ROV-185). A role change, a deactivation and a tier change write the role the member's tokens must carry (or `blocked`) there for 11 minutes, one minute longer than a reseller access token lives. If the key is lost early, a token issued before the change keeps its old role until it expires (at most 10 minutes); refresh tokens are unaffected because the database checks the membership.
- `ImpersonationSessionGuard` reads `impersonation-session:<id>` and its tombstone on every impersonated request.
- One-time impersonation codes, impersonation OTP requests and ws-tickets live only in Redis.

Plan Redis availability with that in mind; a Redis outage blocks reseller users and impersonation.

## Impersonation OTP delivery

Reseller impersonation (and platform impersonation into an institute that requires consent) sends a 6-digit code to the institute admin's primary phone through the notification service (`NOTIFICATION.auth.security`). An institute whose admin has no primary phone cannot be impersonated by a reseller: the request is refused with `IMPERSONATION_CONSENT_UNAVAILABLE`. Make sure institute admins have a primary phone on file, and that the notification service's SMS channel is configured.
