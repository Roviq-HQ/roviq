# Authentication & Authorization

## Recent additions

- **ROV-93** — Scope-prefixed impersonation mutations. The flat `startImpersonation` / `verifyImpersonationOtp` / `endImpersonation` resolvers are gone. Each scope owns its own mutations (see Impersonation).
- **ROV-94** — Cross-scope impersonation OTP gate. Reseller-scope impersonation always requires an OTP; platform-scope honours the new `institutes.require_impersonation_consent` boolean.
- **ROV-96** — `mustChangePassword` invariant + `MustChangePasswordGuard`. Every login that flips the JWT bit forces the user through `changePassword` before any other resolver responds.
- **ROV-209** — Brute-force lockout via `LoginLockoutService` (Redis sliding window) + `IdentityService` boundary for all user/membership writes.

## Data Model

- **User** — platform-level (no RLS), globally unique username/email. No tenantId/roleId.
- **Membership** — three types, each linking User to a scope:
  - `platform_memberships` — User↔Platform role (1:1 per user). `roviq_admin` only: `roviq_app` and `roviq_reseller` hold no table privilege and no policy.
  - `reseller_memberships` — User↔Reseller with role. `roviq_reseller` reads and writes its own reseller's rows, `roviq_admin` all; `roviq_app` holds no table privilege.
  - `memberships` — User↔Institute with role. Tenant-scoped (RLS). Holds per-member `abilities` overrides. `roviq_reseller` reads the rows of its own institutes and cannot write. A platform role never lives here: migration `rov-88-platform-membership-backfill` moves any such row into `platform_memberships`.
- **AuthProvider** — platform-level, tracks auth methods per user (password, passkey, OAuth — future).
- **RefreshToken** — stores `membership_scope` ('platform'|'reseller'|'institute') + `membership_id` (polymorphic, references the scope's membership table).

Design doc: `docs/plans/2026-03-06-user-identity-auth-redesign.md`

## Error Codes

Auth failures carry a machine-readable `extensions.code` (see `docs/architecture.md` → "Error Handling"). The frontend never shows the server message; it maps the code to `auth.errors.<CODE>` in `apps/web/messages/{en,hi}/auth.json`.

| Code | HTTP | Raised when |
|------|------|-------------|
| `UNAUTHENTICATED` | 401 | Access token missing, malformed or expired — the client refreshes and retries |
| `INVALID_CREDENTIALS` | 401 | Wrong Roviq ID or password, unknown or inactive user, or a correct password with no usable membership in this portal (same response, so it does not confirm the credentials) |
| `ACCOUNT_LOCKED` | 401 | Too many failed logins for the Roviq ID |
| `ACCOUNT_NOT_FOUND` | 401 | Passkey login succeeded but the user has no active institute membership |
| `ACCOUNT_INACTIVE` | 401 | The user behind a selection/switch token is deleted or not ACTIVE |
| `SESSION_EXPIRED` | 401 | Refresh or institute-selection token invalid, expired, revoked or reused |
| `PASSWORD_CHANGED` | 401 | Refresh token predates a password change — full re-login, no re-auth dialog |
| `PASSWORD_CHANGE_REQUIRED` | 403 | Token carries `mustChangePassword` |
| `CURRENT_PASSWORD_INCORRECT` | 401 | Wrong password on `changePassword` or when confirming a passkey registration |
| `PASSWORD_UNCHANGED` | 400 | New password equals the current one |
| `NO_ACTIVE_MEMBERSHIP` | 403 | Selected/target membership is missing or not ACTIVE |
| `SESSION_NOT_FOUND` | 403 | Session to revoke does not belong to the user |
| `IMPERSONATION_ENDED` | 401 | Impersonation session ended, expired or revoked |
| `PASSKEY_CHALLENGE_EXPIRED` | 400 | WebAuthn challenge expired or already used |
| `PASSKEY_VERIFICATION_FAILED` | 400 | Passkey registration response rejected |
| `PASSKEY_AUTHENTICATION_FAILED` | 401 | Passkey sign-in rejected (unknown credential or bad signature — deliberately one code) |
| `PASSKEY_NOT_FOUND` | 404 | Passkey missing or owned by another user |
| `PASSKEY_LAST_AUTH_METHOD` | 400 | Removing the passkey would leave no sign-in method |

## Auth Flow (Three-Scope Model)

Three separate login mutations, one per portal:

### Admin Portal: `adminLogin(username, password)`
1. Verifies credentials
2. Looks up `platform_memberships` for user
3. No active membership → `INVALID_CREDENTIALS`, identical to a wrong password. A `login_failed` auth event with `failure_reason = NO_PORTAL_ACCESS` and the attempted `portal` records the real cause
4. Issues scope=platform access token (5min TTL) + refresh token

### Reseller Portal: `resellerLogin(username, password)`
1. Verifies credentials
2. Looks up `reseller_memberships` for user
3. Checks reseller is active (`is_active = true`, `status = 'active'`). No membership or an inactive reseller → `INVALID_CREDENTIALS`, as above
4. Issues scope=reseller access token (10min TTL) + refresh token

### Institute Portal: `instituteLogin(username, password)`
1. Verifies credentials
2. Looks up active `memberships` (institute-scoped) for user. None → `INVALID_CREDENTIALS`, as above
3. **Single membership:** issues scope=institute access token (15min TTL) + refresh token
4. **Multiple memberships:** returns `requiresInstituteSelection: true` + membership list for picker
5. User calls `selectInstitute(membershipId)` → issues scoped tokens

### Institute Switching
- `switchInstitute(membershipId, currentRefreshToken)` — institute scope only, refused during impersonation. `currentRefreshToken` must be a live refresh token of the caller; that one row is revoked (reason `user_initiated`) and new tokens are issued. No re-auth. Every check runs before the revoke, so a rejected switch leaves the session usable.

## JWT Structure

All tokens are `type: 'access'` — no more separate 'platform' type.

- **Access token:** `{ sub, scope, tenantId?, resellerId?, membershipId, roleId, mustChangePassword?, type: 'access' }`
  - TTL: platform 5m, reseller 10m, institute 15m
  - `mustChangePassword: true` is set when the user's `users.must_change_password` column is true (see [First-Login Password Change](#first-login-password-change-rov-96)).
- **Impersonation token:** same as access + `{ isImpersonated, impersonatorId, impersonationSessionId }`
  - TTL: 15m, non-renewable (no refresh token created)
- **Refresh token:** `{ sub, tokenId, membershipId, type: 'refresh' }` — 7d TTL

### Token Refresh
- Refresh token rotation: each use invalidates the old token and issues a new pair (reason `rotation`)
- Each refresh re-reads the user and the membership named in the token (`membershipId` claim). An inactive user gets `ACCOUNT_INACTIVE`; a missing, inactive or soft-deleted membership, a deleted institute or a suspended reseller gets `SESSION_EXPIRED`. A refresh never moves a session to a different membership. The old token is rotated only after these checks pass, so a rejected refresh does not arm reuse detection.
- Reason-aware revocation: `refresh_tokens.revoked_reason` records why a row was revoked. Every revocation path tags itself so the reuse-detection cascade can tell a rotation-replay attack from a late client retry. Values:
  - `rotation` — normal rotate-then-reuse signal. Replay triggers the cascade.
  - `user_initiated` — `logout`, `revokeSession`, `revokeAllOtherSessions`, scope switch (`switchInstitute`).
  - `password_change` — emitted by `changePassword` when it nukes every outstanding session.
  - `admin_revoked` — admin-driven revocation from the admin UI.
  - `NULL` — legacy rows from before the column existed. Treated like `rotation` (cascade) so older data drains out safely.
- Reuse detection: if a revoked token is presented, the cascade (revoke every refresh token for the user) fires ONLY when `revoked_reason` is `rotation` or `NULL`. All other reasons raise `UnauthorizedException('Refresh token revoked')` and leave sibling sessions alive — replaying a logged-out/password-changed/admin-revoked token must not log the user out of every live device.
- Password change invalidation: `password_changed_at > token.created_at` → reject + revoke (reason `password_change`).
- Scope-aware re-issue: checks the correct membership table based on stored `membership_scope`.

`RefreshTokenRevokeReason` is exported from `apps/api-gateway/src/auth/repositories/refresh-token.repository.ts` — every `revoke`/`revokeAllForUser`/`revokeAllOtherForUser` call must pass one of the four values.

## Scope Guards

Class-level decorators from `@roviq/auth-backend`:

- `@PlatformScope()` — rejects if `user.scope !== 'platform'`
- `@ResellerScope()` — rejects if `user.scope !== 'reseller'`
- `@InstituteScope()` — rejects if `user.scope !== 'institute'`

Applied at resolver class level. Combines `GqlAuthGuard` (JWT validation) + scope check.

### A scope guard is not tenant isolation (ROV-290)

A scope guard only proves the token's scope. Which rows the caller may touch is decided by the DB wrapper: `withTenant` and `withReseller` run under RLS, `withAdmin` bypasses it. An institute- or reseller-scope resolver must therefore never pass a caller-supplied id to a query that runs as admin.

- Institute lifecycle (create, activate, suspend, delete, restore) and institute-group management live in `admin/` resolvers; resellers get their own `reseller*` operations, limited to institutes and groups they own.
- Institute scope reads and edits only its own institute (`myInstitute`, `updateInstituteInfo(input)`, `myInstituteGroup`).
- `institute_admin` holds `manage all` minus institute-group management and platform-level `Institute` actions.
- `pnpm check:admin-context-reach` resolves calls from every resolver outside `admin/` and lists each reachable function that opens the admin context, with the reason it cannot be aimed at another tenant. A new one fails CI until it is listed. The reasons are reviewed claims, not proofs: the proof for an operation is a test that sends another tenant's id and asserts refusal.

## Protected Routes
- Backend: `@InstituteScope()` / `@PlatformScope()` / `@ResellerScope()` on resolver classes
- Frontend: `<ProtectedRoute>` component redirects to `/login` with return URL

## WebSocket Authentication (ws-ticket, ROV-95)

graphql-ws connections never carry the JWT. The client exchanges its access token for a short-lived ticket and sends only the ticket in `connectionParams`.

1. `GET /api/auth/ws-ticket` with `Authorization: Bearer <access token>` returns `{ ticket }` (a UUID). `issueWsTicket` stores the full `AuthUser` in Redis under `ws-ticket:<uuid>` for 30 seconds.
2. The client opens the socket with `connectionParams: { ticket }`. `onConnect` in `app.module.ts` calls `consumeWsTicket`, which reads and deletes the key in one `GETDEL`, so a ticket works once even when two sockets race on it.
3. The user is put on `ctx.extra.user` and copied to `req.user` by the GraphQL `context()` wrapper, so `@CurrentUser()`, scope guards and CASL work as on HTTP.

A missing, malformed, unknown, expired or reused ticket closes the socket with code 4403. The stored user is validated on the way in and out (`ws-ticket.store.ts`) and keeps `isImpersonated`, `impersonationSessionId` and `mustChangePassword`, which `ImpersonationSessionGuard` and `MustChangePasswordGuard` read on the subscription path. On reconnect the frontend (`libs/frontend/graphql/src/lib/client.ts`) fetches a new ticket.

## Session Management

- `logout(currentRefreshToken)` — ends only the session of that refresh token (reason `user_initiated`); other devices stay signed in. Succeeds if the session is already gone, rejects a token of another user with `SESSION_EXPIRED`, and is refused during impersonation. The access token stays valid until it expires.
- `mySessions` query — returns active refresh tokens with device_info, ip, last_used_at
- `revokeSession(sessionId)` — revoke a specific session (reason `user_initiated`)
- `revokeAllOtherSessions` — revoke every refresh token for the user EXCEPT the caller's current one (reason `user_initiated`). The caller keeps working on the same token; crucially, the `user_initiated` reason means a stale client replaying one of the killed tokens will hit `Refresh token revoked` without triggering the rotation-reuse cascade (see [Token Refresh](#token-refresh)), so the caller's keep-alive session is not collaterally killed.
- `changePassword` — in addition to clearing the password, revokes every refresh token for the user with reason `password_change`. Cascading is deliberately suppressed for the same reason: a late client retry after a password change should just fail, not replay-attack-cascade.

## Reseller suspension and deletion (ROV-97)

Platform admins suspend, unsuspend and delete resellers through `adminSuspendReseller`, `adminUnsuspendReseller` and `adminDeleteReseller` (`apps/api-gateway/src/admin/reseller/`). The system reseller "Roviq Direct" refuses all three with `SYSTEM_RESELLER_PROTECTED`. The `resellers_protect_system` trigger refuses the same changes in the database, for every role including the superuser.

**Suspension** cuts off the reseller's staff at once:

- The database does the revocation. The `resellers_revoke_sessions` trigger runs when a reseller leaves `ACTIVE`, whatever code changed it. It revokes every reseller-scope refresh token of the reseller's memberships with reason `admin_revoked`, and ends the impersonation sessions its staff opened as reseller with reason `revoked`. Tokens are matched by membership, so the same person's institute sessions are untouched. The reason is required (`chk_refresh_token_revoked_reason`): a revoked token without one would be treated as token theft and revoke every other session of the user.
- Access tokens already issued are rejected by `ResellerAccessGuard`, a global guard that checks the reseller's status on every reseller-scope request and answers `UNAUTHENTICATED`. The database cannot see an access token, so this check stays in the application. The guard caches the answer in Redis for 60 seconds; suspension writes a `blocked` marker that the guard checks first, so there is no wait for the cache to expire.
- The service drops the Redis caches of the ended impersonation sessions, so `ImpersonationSessionGuard` rejects their tokens on the next request (`IMPERSONATION_ENDED`).
- `resellerLogin` and `refreshToken` refuse a reseller that is not `ACTIVE`. Login answers `INVALID_CREDENTIALS`, the same as a wrong password, so it does not confirm the password. The database also refuses a new refresh token for such a reseller.

Institute users of a suspended reseller are not affected. Their institute-scope tokens also carry a `resellerId`, and the guard ignores them on purpose.

**Unsuspending** restores login. Sessions revoked by the suspension stay revoked, so staff sign in again.

**Deletion** needs the reseller to have been suspended for at least 30 days (`GRACE_PERIOD_NOT_ELAPSED` otherwise). It moves the reseller's institutes to Roviq Direct, soft-deletes its memberships and roles, and marks the reseller `DELETED`.

Tests: `apps/api-gateway/src/admin/reseller/__tests__/reseller-suspension.integration.spec.ts` (sessions) and `e2e/api-gateway-e2e/src/admin-reseller-lifecycle.api-e2e.spec.ts` (state guards).

## Active session management (ROV-100)

All three portals expose `/en/{scope}/settings/sessions` (`admin`, `reseller`, `institute`; Hindi uses `/hi/`). The shared session hook reads tokens from the current scope's storage at request time, including after refresh-token rotation. Impersonated tabs cannot use the original account's refresh token for session management.

`mySessions(currentRefreshToken: String!)` identifies the current session by comparing the refresh-token hash with the authenticated user's active sessions. It rejects a token outside that list and returns only session metadata; token hashes never appear in GraphQL. The UI marks the current session, hides its individual revoke button, and displays device, IP, last-active and creation timestamps.

`revokeAllOtherSessions(currentRefreshToken: String!)` requires a token belonging to the authenticated user. The frontend sends the current token and refetches the list after success. The resolver uses `@NoAudit()` because the auth service emits `all_sessions_revoked` without including the refresh token; the generic mutation audit would serialize this sensitive argument. Load failures offer retry, mutation failures show translated feedback, and all session labels are available in English and Hindi.

The shared login form submits through `form.handleSubmit()` and prevents native navigation for both the submit button and Enter. It uses POST as a fallback and keeps credential fields and buttons disabled while auth restores, so credentials cannot be submitted in the page URL before hydration.

Logout sends the access token in the Authorization header so the guarded server mutation runs before local credentials are cleared.

## First-Login Password Change (ROV-96)

Every newly-provisioned user is born with `users.must_change_password = true` and is forced through `changePassword` before any other resolver responds.

- **DB column** — `users.must_change_password BOOLEAN NOT NULL DEFAULT false`. `IdentityService.createUser` sets it to `true`; `AuthService.changePassword` clears it (and bumps `password_changed_at`, which invalidates outstanding refresh tokens).
- **JWT claim** — when the column is true, the access token includes `mustChangePassword: true`. `JwtStrategy` copies it onto `req.user`.
- **Guard** — `MustChangePasswordGuard` is registered as an `APP_GUARD`. It runs after `GqlAuthGuard`. If `req.user.mustChangePassword === true` and the handler is not whitelisted, it throws:

  ```ts
  throw new ForbiddenException({
    code: 'PASSWORD_CHANGE_REQUIRED',
    message: 'You must change your password before continuing.',
  });
  ```

- **Whitelist** — handlers decorated with `@AllowWhenPasswordChangeRequired()` are reachable while the bit is set. Currently: `changePassword`, `logout`, `me`. Add the decorator on any future handler the change-password screen needs to call.
- **Frontend contract** — on receiving `code: 'PASSWORD_CHANGE_REQUIRED'` the web app redirects to `/auth/change-password`. The screen calls `changePassword(currentPassword, newPassword)`; the next access token will not carry the bit.

## Brute-Force Lockout (ROV-209)

`LoginLockoutService` tracks failed login attempts in Redis using a sliding window and locks the account after a threshold.

| Redis key | TTL | Purpose |
|---|---|---|
| `auth:failed-login:<usernameLower>` | `FAILURE_WINDOW_SECONDS` | Failure counter; each new failure rewrites the key and extends the TTL (sliding window). |
| `auth:locked:<usernameLower>` | `LOCKOUT_DURATION_SECONDS` | Hard lock. While present, every login attempt is rejected before the password is even checked. |

| Env var | Default | Notes |
|---|---|---|
| `MAX_LOGIN_ATTEMPTS` | `5` | Failures inside the window before the lock fires. |
| `LOCKOUT_DURATION_SECONDS` | `1800` (30 min) | Lock TTL. |
| `FAILURE_WINDOW_SECONDS` | `900` (15 min) | Sliding-window length for the failure counter. |

Behaviour:

- On the `MAX_LOGIN_ATTEMPTS`-th failure the service writes the lock key and emits an `account_locked` row into `auth_events`.
- A successful login clears `auth:failed-login:*` but **leaves any active lock in place** — a stale success cannot rescue a locked account, the lock TTL must elapse.
- Locked-account login response:

  ```ts
  throw new UnauthorizedException({
    code: 'ACCOUNT_LOCKED',
    message: 'Too many attempts. Try again in 30 minutes.',
  });
  ```

- Username matching is case-insensitive (`usernameLower`) so attackers cannot defeat the counter by toggling case.

## Impersonation

> Source-of-truth detail: `docs/plans/auth-final-prd.md` §12.

### Mutations (ROV-93)

The flat impersonation resolver is gone. Each scope owns its own mutations and the only resolver kept on `auth/impersonation.resolver.ts` is the unauthenticated code-exchange endpoint.

| Scope | Start | Verify OTP | End |
|---|---|---|---|
| platform | `adminStartImpersonation` | `adminVerifyImpersonationOtp` | `adminEndImpersonation` |
| reseller | `resellerStartImpersonation` | `resellerVerifyImpersonationOtp` | `resellerEndImpersonation` |
| institute | `impersonateUser` | _n/a (no OTP gate)_ | `endImpersonation` |
| _(unauthenticated)_ | `exchangeImpersonationCode` | — | — |

Update any tooling, sequence diagrams, or audit-log filters that referred to the old flat names.

### OTP Gate (ROV-94)

A new `institutes.require_impersonation_consent BOOLEAN NOT NULL DEFAULT false` column drives the OTP gate together with the impersonator's scope:

| Impersonator scope | OTP required? |
|---|---|
| Reseller | Always |
| Platform | Only when target institute has `require_impersonation_consent = true` |
| Institute (intra-institute) | Never (CASL ability + role hierarchy still apply) |

Flow when the OTP gate fires:

1. Caller invokes `<scope>StartImpersonation(input)`.
2. Backend generates a 6-digit OTP and parks the whole request (impersonator, target, reason, IP, recipient) at Redis key `impersonation-otp:{requestId}` with `EX 300` (5 min). It emits `NOTIFICATION.auth.security` with `eventType: 'IMPERSONATION_OTP'`; the notification-service delivers it via Novu to the institute's longest-standing active `institute_admin`. **No `impersonation_sessions` row exists yet**, so an abandoned request never shows up as an active session.
3. Resolver returns `{ sessionId, requiresOtp: true }` instead of `{ code }`. `sessionId` here is the pending request id.
4. Institute admin reads the OTP and shares it with the impersonator out-of-band.
5. Caller submits `<scope>VerifyImpersonationOtp(sessionId, otp)`.
   - Only the user who started the request may verify it; anyone else is refused without spending an attempt.
   - With the right OTP the scope checks of the start step run again (same scope, reseller membership still active, institute still owned by that reseller) before the session is written.
   - Every attempt is reserved with an atomic `INCR` on `impersonation-otp:{requestId}:attempts` before the OTP is compared, so parallel guesses cannot share an attempt; after **3 wrong attempts** the request is deleted.
   - Correct OTP consumes the request with `GETDEL`, writes the session row with `otp_verified` and `otp_verified_by` (the admin the OTP went to), and returns the same `{ code }` payload the no-OTP path returns.
6. When OTP is not required (institute has consent disabled and impersonator is platform), `startImpersonation` returns `{ code, requiresOtp: false }` directly.

### Who may impersonate whom (ROV-94)

- Starting impersonation and verifying its OTP need `impersonate User` in every scope. By default: `platform_admin`, `platform_support`, `reseller_full_admin`, `reseller_support_admin`, `institute_admin` and `principal`.
- **Reseller**: the institute's `reseller_id` must equal the `resellerId` in the caller's token, and that reseller membership must still be active.
- **Intra-institute** (`canImpersonateInstituteRole()` in `@roviq/common-types`): the target's role must rank strictly below the caller's (`INSTITUTE_ROLE_RANK`), counting every membership the target holds in the institute. A caller without full control (the principal by default) may additionally act only as a teacher, student or parent; other staff roles hold abilities a principal lacks (fees, health records, counselor notes, system settings) and are reachable only by the institute admin. An institute admin cannot impersonate another institute admin. Any role granting `manage all` ranks with the institute admin whatever it is called; other custom roles rank as staff.
- **No nesting**: an impersonation token can neither start nor OTP-verify another impersonation.
- The impersonation token carries the same `resellerId` claim as a normal institute token, lasts 15 minutes and has no refresh token.
- The membership checked at start is pinned in the OTP request and the one-time code; `exchangeImpersonationCode` issues the token for exactly that membership.
- `exchangeImpersonationCode` issues no token if the session was ended or has expired since the code was created.
- Frontend: a tab holding `roviq-impersonation-token` loads the impersonated user through `me` (`AuthProvider` `currentUserQuery`) and acts as that user, whether or not the impersonator has a session of their own in the browser. A rejected token is dropped and the tab is signed out.

### Ending and revoking a session (ROV-94)

`adminEndImpersonation`, `resellerEndImpersonation` and `endImpersonation` all call `ImpersonationService.endImpersonation(sessionId, actor)`:

| Caller | Result |
|---|---|
| The impersonator, or the impersonated user (from the impersonation token) | `ended_reason = 'manual'` |
| A platform user with `impersonate User` | `revoked` — any session |
| A reseller user with `impersonate User` | `revoked` — sessions started by their own reseller team |
| An institute user with `impersonate User` | `revoked` — sessions into their own institute |
| Anyone else, or an impersonation token for a different session | `FORBIDDEN` |

Either way the next request with that impersonation token fails with `IMPERSONATION_ENDED`.

### Session Revocation Guard

`ImpersonationSessionGuard` (in `apps/api-gateway/src/auth/middleware/impersonation-session.guard.ts`) is registered as an `APP_GUARD` and short-circuits any request whose bearer token carries a revoked or expired impersonation session.

Because `APP_GUARD` runs BEFORE the per-resolver `GqlAuthGuard` has populated `req.user` (via passport-jwt), the guard cannot rely on `req.user` for HTTP requests. It therefore self-verifies the JWT from the `Authorization: Bearer …` header using `JWT_SECRET` and reads the impersonation claims directly. An earlier version only read `req.user` and silently no-op'd on the HTTP path, so `endImpersonation` never actually stopped in-flight impersonation tokens — fixed by the header-fallback decode. The subscription path still reads `req.user` because graphql-ws has no Authorization header and the `onConnect`/`context()` wrapper in `app.module.ts` is the authoritative source there.

`endImpersonation` writes both a cache `del` AND a `${key}:tombstone` marker (TTL > session cache TTL) so a concurrent guard mid-lookup can't repopulate a stale "not-ended" entry. The tombstone is checked before the cache read.

### Starting and ending in the web app (ROV-101)

- **Where it starts.** Admin portal: institute → Users tab. Reseller portal: institute → Users tab (`resellerListUsers`; `reseller_full_admin` holds `read User` for this). Institute portal: "View as" on the staff and student detail pages. Each shows the action only with `impersonate User` and only for an active user with an active membership in that institute; the server still decides (role rank, reseller ownership, OTP).
- **The new tab.** `ImpersonateUserDialog` asks for a reason (≥10 characters) and, when `requiresOtp` comes back, the institute admin's 6-digit code. The tab is opened on the click, before the request, so popup blockers allow it; it is then pointed at `<institute portal>/<locale>/auth/impersonate?code=…` with `opener` cleared. The institute portal's origin is `NEXT_PUBLIC_INSTITUTE_URL` when set (production: `https://app.roviq.com`), otherwise the current host without its `admin.`/`reseller.` label.
- **The code exchange page** trades the one-time code for the token and keeps it in `sessionStorage` only, so it dies with the tab and never touches a session the browser holds on that portal. A spent or unknown code shows "Code expired or invalid"; error text is always translated, never the server's message.
- **Ending.** "Exit Impersonation" calls `endImpersonation` first, so the session stops showing as active, then drops the token and closes the tab. Token expiry and a server refusal (`IMPERSONATION_ENDED`, e.g. after a reseller suspension) show the same "session ended" notice. Browsers may refuse `window.close()`, so the notice keeps a "Close tab" button.

### Session Management UI (ROV-144)

Read models over `impersonation_sessions` surface sessions for review and termination:

| Query | Scope | Returns |
|---|---|---|
| `adminImpersonationSessions(activeOnly, sessionId, first)` | platform | All sessions across scopes (newest first) |
| `resellerImpersonationSessions(activeOnly, sessionId, first)` | reseller | Sessions started by the reseller's own team |

Both return `ImpersonationSessionModel` — the row plus resolved display names (impersonator, target user, OTP verifier) and the target institute name, with a derived `status` of `ACTIVE` / `ENDED` / `EXPIRED` (from `endedAt` then `expiresAt`). RLS on `impersonation_sessions` grants resellers full read, so `listSessions` enforces the team scope explicitly by filtering impersonators to the reseller's `reseller_memberships`.

The audit-log filter (`AuditLogFilterInput`) gained three impersonation fields, used by the admin audit page:

- `impersonatedOnly` — rows written during any impersonation session (`impersonation_session_id IS NOT NULL`).
- `impersonatorScope: [String!]` — restrict to impersonator scopes (joins `impersonation_sessions`; the join is added only when this filter is set).
- `impersonationSessionId` — the audit entries recorded during one session (powers the detail panel).

Frontend:

- **Admin** (`/admin/audit-logs`, Impersonation tab) — an impersonator-scope multi-select filter, and a session detail side-panel (opened from an audit row) showing session metadata plus every audit entry recorded during that session.
- **Reseller** (`/reseller/audit/impersonation`) — a sessions table with status badges, a **Terminate** action on active sessions (`resellerEndImpersonation`), and an institute filter sourced from `resellerInstitutes`.

E2E fixtures live in `libs/database/src/seed/e2e/impersonation.ts` (one active + one ended reseller-scoped session, one active platform session).

## Auth Events (ROV-96)

`AuthEventService.emit()` writes one `auth_events` row per auth lifecycle step, straight to PostgreSQL under `withAdmin` (no NATS, so a NATS outage never drops a failed-login record). Calls are fire-and-forget: a failed insert is logged and never fails the login. `auth_events` is separate from `audit_logs` by design. Platform admins read it through `adminAuthEvents`.

| `event_type` | Emitted by | Columns and `metadata` |
| --- | --- | --- |
| `login_success` | `adminLogin`, `resellerLogin`, `instituteLogin`, `selectInstitute`, passkey sign-in (each also sends the new-login notification) | `portal`, `scope` (always equal), `tenant_id` or `reseller_id`, `auth_method` (`password` / `passkey`), ip, user agent |
| `login_failed` | every refused sign-in attempt | `portal`, `auth_method`, `failure_reason`; `scope`, `tenant_id`, `reseller_id` are always NULL; `user_id` is set when an account matched, otherwise `metadata.username_lower` |
| `logout` | `logout` | `scope`, `tenant_id` or `reseller_id`, `metadata.membership_id` |
| `token_refresh` | `refreshToken` | `scope`, `tenant_id` or `reseller_id`, ip, `metadata.membership_id` |
| `institute_switch` | `switchInstitute` | `scope='institute'`, `metadata: { from_tenant_id, to_tenant_id }` |
| `impersonation_start` | `exchangeImpersonationCode` | `user_id` and `scope` are the impersonator's, `tenant_id` the target institute, `metadata: { target_user_id, target_tenant_id, session_id }` |
| `impersonation_end` | `endImpersonation` (all scopes), reseller suspension, expiry sweep | `user_id` and `scope` are the actor's (the impersonator's on expiry), `metadata: { session_id, ended_reason }` (`manual` / `revoked` / `expired`) |
| `password_change` | `changePassword` | always followed by `all_sessions_revoked` |
| `all_sessions_revoked` | `changePassword`, `revokeAllOtherSessions`, refresh-token reuse, reseller suspension | `metadata.reason`: `password_change`, `user_initiated`, `token_reuse`, `reseller_suspended` |
| `account_locked` | `LoginLockoutService`, on the attempt that reaches the threshold | `portal`, `failure_reason = TOO_MANY_ATTEMPTS`, `metadata: { username_lower, attempts, lockout_seconds }` |
| `passkey_register` | passkey registration | `metadata: { passkey_id, device_type, backed_up, aaguid }` |

- `auth_events` has no `membership_id` column; the membership goes in `metadata.membership_id`.
- **`portal` vs `scope`.** `portal` is the entry point the request came through (`platform` / `reseller` / `institute`), known before any authentication. `scope` is the authority of the session that was granted. A refused attempt has a portal and never a scope; a granted session has both and they are equal. Events with no entry point (token refresh, expiry sweep) have no portal.
- **`failure_reason`** is an `AuthFailureReason` code from `@roviq/common-types`. It is internal detail: the API answers all of them with the same `INVALID_CREDENTIALS` (or `ACCOUNT_LOCKED`) error.

| `failure_reason` | Meaning |
| --- | --- |
| `UNKNOWN_USER` | No account has the submitted username |
| `INVALID_PASSWORD` | Account exists, wrong password |
| `ACCOUNT_INACTIVE` | Account exists but is not `ACTIVE` |
| `ACCOUNT_LOCKED` | Attempt made while the username was locked out |
| `NO_PORTAL_ACCESS` | Credentials valid, no usable membership in that portal |
| `PASSKEY_UNKNOWN` | Passkey credential is not registered |
| `PASSKEY_VERIFICATION_FAILED` | Registered passkey, signed response failed verification |
| `TOO_MANY_ATTEMPTS` | On `account_locked`: the attempt that reached the lockout threshold |

- Database guards on `auth_events`: `chk_auth_events_portal`, `chk_auth_events_scope` and `chk_auth_events_failure_reason` restrict the value sets; `chk_auth_events_login_portal` requires a portal on `login_success` / `login_failed` / `account_locked`; `chk_auth_events_login_success_scope` requires `scope = portal`; `chk_auth_events_refused_attempt` requires a failure reason and forbids scope, tenant and reseller on refused attempts.
- Expiry: `ImpersonationExpirySweeper` runs `ImpersonationService.expireOverdueSessions()` every minute. It sets `ended_at = expires_at`, `ended_reason = 'expired'` on sessions past `expires_at` and writes `impersonation_end` with the impersonator as `user_id`. The claiming `UPDATE … RETURNING` is atomic, so several gateway replicas record each session once. Such a session still lists as `EXPIRED`, not `ENDED`.

## IdentityService Boundary (ROV-209)

Institute services (student, staff, guardian, admission, …) and Temporal activities **must not** write to `users`, `memberships`, `platform_memberships`, or `reseller_memberships` directly. All identity writes go through `IdentityService` (DI provider in `AuthModule`):

- Argon2id-hashes a freshly-generated temporary password.
- Inserts the `users` row with `must_change_password = true`.
- Creates the appropriate membership row(s) inside the same transaction wrapper.
- Emits `NOTIFICATION.user.created` so the notification-service can deliver welcome credentials (Roviq ID + temp password) via Novu.

This gives us one place to enforce password policy, audit the creation event, and (in future) plug in passkey provisioning. Reviews should reject any new `db.insert(users)` / `db.insert(memberships)` outside `auth/identity.service.ts`.

## CASL Authorization

### Backend
- `AbilityFactory` creates abilities per request from `Membership.abilities` + `Role.abilities`
- `@CheckAbility({ action, subject })` decorator + `AbilityGuard` for resolver-level checks
- `@CurrentAbility()` param decorator for imperative checks in resolver body
- Role abilities cached in Redis with key `casl:role:{roleId}`, 5-minute TTL
- Platform scope uses the role's abilities like the other scopes: `platform_admin` is `manage all`, `platform_support` is read-only plus impersonation
- `AbilityGuard` must come after `GqlAuthGuard` in the class-level chain: `@UseGuards(GqlAuthGuard, <Scope>ScopeGuard, AbilityGuard)`. A separate `@UseGuards(AbilityGuard)` under a scope decorator runs before authentication. `ability-guard-wiring.spec.ts` fails on a `@CheckAbility` without the guard and on a mis-ordered chain
- Starting impersonation and verifying its OTP need `impersonate User` in every scope; listing sessions needs `read AuditLog`. Changing tenant notification channels needs `update_config Institute`

### Student and admission reads

Student lists, direct lookup, counts, statistics, documents, academic history, and student subscriptions enforce the current CASL read policy. Enquiry/application lists, application lookup, admission statistics, and their subscriptions apply the same row restrictions before pagination or aggregation. Guardian lists and direct lookup enforce guardian row policies; linked-child counts, linked-student lists, and student-contact lookups apply the policy to the exact linked student. Linked-student fields retain the student field policy. Teacher section assignments and guardian links are loaded from the database for each ability build; client claims cannot widen access.

GraphQL field middleware masks fields on student, enquiry, and application responses, including mutation and subscription results. Restricted student fields are nullable. Sensitive values in application `formData` are removed recursively. Filters and sorting on restricted student fields are rejected to prevent inference from counts or ordering.

Default policies retain `institute_admin` and `admin_clerk` access. Principals retain Aadhaar/PAN access; income and medical information are masked. Nurses and counselors retain their medical grants; counselor notes require the `CounselorNotes` permission. Custom role and membership grants remain explicit policy overrides.

The `20261114164236_rov-204-read-permissions` migration updates existing default institute roles, narrows parent reads to linked students, and leaves custom roles and `admin_clerk` unchanged. After approval for the target database, apply it with `pnpm tilt trigger db-migrate` before admitting pilot traffic. The resource is manual and does not run automatically. Invalidate affected `casl:role:{roleId}` Redis entries or allow their five-minute TTL to expire before traffic resumes. No schema or RLS policy changes are required; the existing tenant policies and live views remain in force.

### Attendance section scope

Attendance reads and writes apply the caller's `Attendance` rules within the institute. `apps/api-gateway/src/institute/attendance/repositories/attendance-scope.ts` translates those rules into SQL against the section, session and entry. Session lists, session lookups, entries, session counts, date totals, absentee reports, daily breakdowns and student history apply this restriction before selecting or aggregating rows. When a section filter is omitted, the query still returns only authorized sections. A session in another section returns `ATTENDANCE_SESSION_NOT_FOUND`.

Opening, overriding, marking, bulk-marking and deleting attendance load the session and section from the database and check `ability.can(action, subject('Attendance', …))`. Marking also requires that the student already has an entry in that session or is enrolled in its section for that academic year. Opening a session rejects an academic year that does not own the section. It also seeds entries from the section's roster for the session's own academic year.

Editing a session dated before today requires `overridePastDay: true` and `ability.can('update', subject('AttendanceOverride', …))`. `AttendanceOverride` is a separate subject: section-scoped `manage Attendance` grants, such as the class teacher's, do not imply it. Only `manage all` (institute admin) or an explicit grant allows past-day edits. Without it the request fails with `ATTENDANCE_OVERRIDE_FORBIDDEN`.

The default `student` rule reads attendance where `studentId` equals `$user.membershipId`, because attendance entries store the student's membership ID. Migration `20261115145213_rov-268-student-attendance-identity` replaces the earlier `${user.id}` condition in existing default `student` roles.

`attendanceAbsenteesReport` accepts `standardId` so that a report for one standard excludes the caller's other authorized standards. Student lists evaluate section restrictions against enrolment in the requested `academicYearId`, or the active year when none is given.

The default `parent` role reads attendance only for linked children: `{ studentProfileId: { $in: '$user.linkedStudentIds' } }`. Guardian links are loaded from the database each time the ability is built. A parent without a linked child sees no attendance. Migration `20261115140242_rov-268-parent-attendance-scope` adds this condition to existing default `parent` roles and leaves custom roles unchanged. Apply it with `pnpm tilt trigger db-migrate` after approval for the target database. Then invalidate the affected `casl:role:{roleId}` Redis entries or wait for their five-minute TTL to expire.

`caslToSqlWhere(ability, action, subject, columns)` requires a Drizzle column for every CASL condition field. Use an `alias()` column when the predicate runs inside a correlated subquery. If a rule references an unmapped field, the predicate is `false`, which denies access instead of guessing an identifier. Build correlated predicates with Drizzle's `QueryBuilder` and `exists()`. Do not write SQL text with table or column names.

`attendanceSections(academicYearId)` returns the sections the server permits. The attendance and report pages build their standard and section selectors from this list. They preselect the only permitted section, discard URL values the list does not contain, and send no section-scoped request until the list loads. `attendanceCountsForDate` returns `sessionCount`, `studentCount` and per-status mark counts. When a section has several periods, each session counts as a separate mark.

### Frontend
- `AbilityProvider` hydrates CASL ability from login response
- `<Can I="create" a="Student">` for conditional rendering
- `useAbility()` hook for imperative checks
- `<RouteGuard action="read" subject="User">` for page-level access control

### Default Roles

| Scope | Role | Abilities |
|-------|------|-----------|
| platform | platform_admin | manage all |
| platform | platform_support | read all + impersonate |
| reseller | reseller_full_admin | manage institutes, manage team, impersonate |
| reseller | reseller_support_admin | read-only + impersonation |
| reseller | reseller_viewer | read stats |
| institute | institute_admin | manage all (within tenant) |
| institute | teacher | read students/sections/standards/subjects/timetables, CRU attendance |
| institute | student | read timetable/subjects, read own attendance |
| institute | parent | read timetable/attendance/students |

### Platform and reseller system roles

- Platform roles (`platform_admin`, `platform_support`) are single global rows with fixed seed ids.
- Each reseller owns its own copy of the three reseller roles (`roles.reseller_id` = that reseller). `provisionResellerSystemRoles(tx, resellerId, actorId)` from `@roviq/database` creates or refreshes the copies; abilities come from `RESELLER_SYSTEM_ROLE_ABILITIES`. It runs in `adminCreateReseller` and `adminChangeResellerTier`. The essential seed only maintains the Roviq Direct copies (fixed seed ids). Migration `rov-91-reseller-role-backfill` gives resellers that predate this their own copies and moves any `reseller_memberships` row that still points at another reseller's role onto them.
- `resellerInviteTeamMember` rejects a `roleId` that is not a live reseller-scope role of the caller's reseller. Deleting a reseller soft-deletes its roles.
- Database guards: `chk_role_scope` rejects unknown scopes and wrong tenant/reseller combinations; role names are unique per platform (`roles_platform_name_key`) and per reseller (`roles_reseller_id_name_key`) among live rows. `refresh_tokens.membership_scope` and `impersonation_sessions.impersonator_scope` accept only `platform`, `reseller`, `institute`.
- `auth_events`: `roviq_app` and `roviq_reseller` hold the INSERT table privilege only; `roviq_admin` reads.


## Account language

`users.preferred_locale` is nullable and constrained to `en` or `hi`. `myPreferredLocale` and `updateMyPreferredLocale(input)` use the authenticated user ID in all three scopes; clients cannot target another account. Impersonated sessions may read but cannot save account preferences. Existing `users` RLS remains enabled: runtime roles can read; writes use the auth repository's existing admin wrapper.

The auth context fetches the preference on account restoration/login. Saved language takes precedence after authentication (ROV-52 product decision); without a saved language, browser languages are matched in order, then English is used. Each account applies this once per document load and preserves the path, query and fragment. Locale navigation can remount providers without reapplying the saved language; a full refresh applies it again. Account settings save across visits; the topbar selector overrides only the current visit. Selecting "Use browser language" clears the account preference. Failed loads leave authentication usable and expose retry in account settings; failed saves retain the previous value.
