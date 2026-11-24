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
| `*_rov-296-export-reports` | Adds the `ComplianceReportType` and `ExportReportStatus` enums, the file purpose `COMPLIANCE_EXPORT`, and the `export_reports` table (with `export_reports_live`, tenant RLS and CHECK constraints tying `COMPLETED` to a file, a row count and a completion time, and `FAILED` to an error code). Compliance exports answer with a database error until it runs. |
| `*_rov-292-tenant-user-profiles`, `*_rov-292-tenant-user-profiles-copy` | Adds `tenant_user_profiles` (an institute's own copy of a person's name, demographics and picture) with tenant RLS, and makes `phone_numbers_country_code_number_key` unique for verified numbers only. The second migration copies every `user_profiles` row once for each institute the user is a member of. A picture moves to the institute copy when the person belongs to one institute (the file becomes that institute's); a person in several institutes keeps it as the account picture and each institute sets its own. The API must not take traffic before both have run: the institute portal reads names from the new table only. |

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

## Malware scanning of uploads

**Off in production for now** (owner's decision, 2026-11-21): with `FILE_SCANNER` unset, a
production gateway stores and serves uploaded documents unscanned and logs a warning at start.
The scanning code is in place (ROV-303); turning it on needs only the steps below.

What scanning does when on: every uploaded file that is not an image (PDF, CSV, XLSX) is
scanned before it can be attached to a record. Images are not scanned: they are re-encoded, and
only the re-encoded sizes are stored.

`FILE_SCANNER` values:

- `off`: no scanning. The default when `NODE_ENV=production`.
- `clamav`: scan through a ClamAV daemon. Needs `CLAMAV_HOST` (and `CLAMAV_PORT` if not 3310);
  the gateway does not start without it.
- `eicar`: detects only the EICAR test file. The default outside production, for development
  and automated tests; refused when `NODE_ENV=production`.

To turn scanning on:

- Run the `clamav/clamav` image (the commented `clamav` service in `docker/compose.app.yaml`)
  and set `FILE_SCANNER=clamav` and `CLAMAV_HOST` on every api-gateway.
- **Memory and start-up:** `clamd` keeps its signatures in memory, about 1.5 GB. The first start
  downloads the signature database; keep `/var/lib/clamav` on a volume. The image runs
  `freshclam` itself, so it needs outbound HTTPS to `database.clamav.net`.
- **Not reachable from outside:** `clamd` has no authentication. Keep port 3310 on the private
  network only.
- **Size limit:** the largest upload is 50 MB. `clamd` refuses a stream above its
  `StreamMaxLength` (100 MB in the official image); do not lower it below 50 MB.
- **When the scanner is down** uploads of documents fail with `FILE_SCAN_UNAVAILABLE` and can be
  retried; nothing unscanned is attached. Alert on the health check of the container.
- **An infected file** is refused with `FILE_INFECTED`, its bytes are deleted and its `files`
  row stays with status `QUARANTINED`. A `FILE.quarantined` event and an audit entry
  (`quarantineFile`) name the uploader and the institute.
- **To test a deployment** upload the EICAR test file as a `.csv` where a CSV is accepted (bulk
  student import). ClamAV recognises EICAR only at the start of a file, so an EICAR string
  placed after a PDF header is reported clean.

## Telemetry and shutdown

- **OpenObserve** stores logs, metrics and traces and runs the dashboards and alerts
  (`docs/infrastructure.md` → "Observability"). `docker/compose.app.yaml` runs it as the
  `openobserve` service with a memory limit (2 GB), a CPU limit, a named data volume
  (`roviq-openobserve`), bounded cache, memtable and write-ahead-log sizes and 30 days of
  retention. It publishes no port: reach its UI over the private network (a reverse proxy
  with its own access control, or an SSH tunnel to port 5080). It shares the server with the
  apps, so it goes down with them: an uptime check from outside is still needed.
- **Required variables** (compose refuses to start without them): `OPENOBSERVE_USER` (an
  email address; it becomes OpenObserve's first user and receives alert emails),
  `OPENOBSERVE_PASSWORD` (8 to 128 characters with a lower-case letter, an upper-case letter,
  a digit and a special character, or the container exits) and `OTEL_EXPORTER_OTLP_HEADERS`,
  the gRPC metadata the gateway's and the notification service's exporters send:
  `authorization=Basic <base64 of user:password>,organization=default,stream-name=default`
  (`printf '%s' "$OPENOBSERVE_USER:$OPENOBSERVE_PASSWORD" | base64 -w0`).
- **One account for everything.** The open-source OpenObserve has only full-access roles, so
  the exporters, the gateway's queries, the admin portal's proxy routes and the loader all use
  `OPENOBSERVE_USER`. Anyone who can read the gateway's or the web app's environment can read
  and delete all telemetry. The password never reaches a browser: the proxy routes build every
  query on the server and require a platform-admin token.
- **Alert emails** need a mail server: set `OPENOBSERVE_SMTP_ENABLED=true`,
  `OPENOBSERVE_SMTP_HOST`, `OPENOBSERVE_SMTP_PORT`, `OPENOBSERVE_SMTP_USER`,
  `OPENOBSERVE_SMTP_PASSWORD`, `OPENOBSERVE_SMTP_FROM` and, if not STARTTLS,
  `OPENOBSERVE_SMTP_ENCRYPTION`. OpenObserve does not save an alert without a destination, so
  without a mail server the loader loads the dashboards and then stops with a message.
  More recipients: add them as users in OpenObserve and list them in `OPENOBSERVE_ALERT_EMAILS`.
- **Each deploy** runs `pnpm observability:load` with `OPENOBSERVE_URL`, `OPENOBSERVE_USER` and
  `OPENOBSERVE_PASSWORD` set, from a place that can reach port 5080. It creates or updates the
  dashboards and alerts in `docker/openobserve/` and changes nothing when they already match.
- **The web image** needs `NEXT_PUBLIC_OPENOBSERVE_URL` at build time: the address at which an
  operator's browser reaches the OpenObserve UI, used by the "Open in OpenObserve" links.
- **Telemetry is off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set.** Unset, an app starts
  no SDK and exports nothing; set to an unreachable address, every export fails and the data
  is lost. Application logs also stay on the server's disk through Docker, which is the
  fallback when OpenObserve is down.
- **What is exported.** Logs: the message, level, module, error stack, trace id and, for a
  request, its method, path and status. The request logger never writes headers, bodies or
  query strings (`libs/backend/telemetry/src/redaction.ts`), and the notification service's
  `/webhooks/` requests are not traced, since their path or query carries a secret. Traces: HTTP method,
  route, path with its query string, status, the client's IP address and user agent; SQL
  statements with placeholders, never their parameter values; GraphQL documents with every
  literal value replaced by `*`, never the variables; Redis command names without keys or
  values. Metrics: counts and durations labelled by route, institute id (`tenant_id`),
  stream and similar identifiers. Not exported: the host name, the process command line and
  the operating-system user.
- **What remains personal data in OpenObserve**: client IP addresses and user agents on
  request spans, institute and record ids in metric labels and log messages, and whatever an
  error message itself quotes. Treat the OpenObserve volume and its backups as personal data,
  and keep its retention period no longer than the application's own log retention.
- On SIGTERM the gateway and the notification service stop accepting connections, finish
  in-flight requests, stop their consumers and Temporal workers, close NATS, Temporal, database
  pools and Redis, flush telemetry (at most 2 s) and exit 0. Past 10 s they exit 1 and log what
  had not closed. Give the container a stop grace period above 10 s (Docker's default of 10 s
  cuts it short; Kubernetes' 30 s is enough).

## Event consumers

The api-gateway is a JetStream consumer as well as a publisher (ROV-316). At start-up it creates
or updates its durable consumers (`gateway-*`) on the `ACADEMIC_YEAR`, `SECTION`, `STUDENT` and
`GROUP` streams and fails to start if NATS refuses, so its NATS account needs JetStream consumer
management on those streams. Every gateway instance binds the same durables and shares the work.
On the first start after this change the consumers receive the messages already retained in
those streams; the handlers are idempotent, so this is safe.

## Background workers

Temporal workers run inside the api-gateway process, switched on per instance with a
`*_WORKER_ENABLED=true` variable. Set each flag on exactly the gateway instances that should run
that worker; every instance needs `TEMPORAL_ADDRESS` to reach Temporal. A worker that fails to
start or stops (Temporal restarted, connection lost) tries to start again every 30 seconds.

- **`FILE_SWEEPER_WORKER_ENABLED`** (ROV-300): the hourly file sweeper (`docs/architecture.md` →
  "File sweeper"). It creates the `file-sweeper-hourly` schedule at start if Temporal does not
  have it, so it needs Temporal reachable at start; the schedule skips a run while the previous
  one is still going, so more than one instance is safe but wasteful. Without any instance
  running it, stale uploads and deleted files are never removed from storage. The storage
  access key needs delete rights on both buckets (already in the list under "Object storage").
  It connects with `DATABASE_URL` and runs its queries as `roviq_admin`.
- **`COMPLIANCE_EXPORT_WORKER_ENABLED`** (ROV-296): runs `ComplianceExportWorkflow` on task
  queue `compliance-export`, which builds a compliance export (UDISE+, CBSE, BSEH, Shala Darpan,
  RTE, TC register, admission register) and stores it as a `COMPLIANCE_EXPORT` file. Without any
  instance running it, a requested export stays `PENDING` and is never built. An export still `PENDING` or `RUNNING` 35 minutes after it was requested (the 30-minute workflow timeout plus a margin) is marked `FAILED` with `EXPORT_TIMED_OUT` the next time that institute's exports are listed or requested. More than one instance is safe: Temporal hands each export to one worker.
  It connects with `DATABASE_URL` and runs every query as the institute being exported
  (`roviq_app` with RLS). Needs `TEMPORAL_ADDRESS` and the object storage write access the
  gateway already has.
- **`TC_ISSUANCE_WORKER_ENABLED`** (ROV-232): runs `TCIssuanceWorkflow` on task queue
  `tc-issuance` (or `TEMPORAL_TC_TASK_QUEUE`, which the gateway that starts the workflow must
  share). It moves a requested TC through clearance to `GENERATED`; without any instance running
  it, a TC stays `REQUESTED` and can never be approved or issued. More than one instance is safe.
  It connects with `DATABASE_URL` and runs its queries as `roviq_app` (the TC's institute) and
  `roviq_admin`.
- **`INSTITUTE_SETUP_WORKER_ENABLED`** (ROV-232): runs `InstituteSetupWorkflow` on task queue
  `institute-setup`, which approving an institute request starts. Without any instance running it,
  an approved institute's setup never reaches `COMPLETED`. More than one instance is safe.
  It connects with `DATABASE_URL` and runs its queries as `roviq_admin`.
- **`AUDIT_PARTITION_WORKER_ENABLED`** (ROV-232): runs `auditPartitionManagement` on task queue
  `audit-maintenance` and creates or updates the `audit-partition-cron` schedule (2 AM UTC on the
  25th) at start, keeping an operator's pause. Each run creates next month's `audit_logs`
  partition, detaches partitions older than a year and checks the new one is attached. The
  gateway already creates partitions at boot and daily; only this worker enforces retention.
  It connects with `DATABASE_URL` and runs as `roviq_admin`, reaching partition DDL through the
  `SECURITY DEFINER` functions `ensure_monthly_partition` and `detach_monthly_partition`.

## Notification delivery

The notification service writes in-app notifications to Postgres and delivers email, push, SMS
and WhatsApp itself (ROV-314). It needs `TEMPORAL_ADDRESS`, and
`NOTIFICATION_WORKER_ENABLED=true` on at least one notification-service instance: that worker
runs the delivery and digest workflows on task queue `notifications`. Without it, in-app rows are
still written but no email, push or WhatsApp message is sent. Codes and temporary passwords
(email verification, impersonation OTP, welcome) do not use Temporal; they are sent at once.

Each channel needs a provider; a channel with none records every send as skipped (`no_provider`).

**WhatsApp needs the guardian's consent as well as a provider** (ROV-269, DPDP purpose-specific
consent). A guardian of the institute gets a WhatsApp message only while the latest
`consent_records` row with purpose `whatsapp_communication` is granted, for the student the
message is about (for a message that names no student: for every student linked to them). No row counts as
no consent. The row is read on every send and nothing is cached, so a withdrawal applies to the
next message. A refused send is recorded as skipped (`no_consent`) and logged with the reason
(`consent_missing` or `consent_withdrawn`) and ids only. Other channels, and recipients who are
not guardians (staff), are not gated by this consent; SMS consent (`sms_communication`) is not
enforced yet.

- **Email**: `NOTIFICATION_EMAIL_PROVIDER=smtp`, `SMTP_URL` (`smtps://user:pass@host:465`) and
  `EMAIL_FROM` (`Roviq <no-reply@your-domain>`). The sending domain needs SPF and DKIM.
- **Push**: `NOTIFICATION_PUSH_PROVIDER=fcm` and `FCM_SERVICE_ACCOUNT_JSON`, the whole service
  account key JSON of the Firebase project. Tokens FCM reports as unregistered are retired.
- **SMS**: `NOTIFICATION_SMS_PROVIDER=http`. See "SMS" below. Leave it unset until the sender
  and the templates are registered; impersonation codes then cannot reach a phone.
- **WhatsApp**: `NOTIFICATION_WHATSAPP_PROVIDER=cloud`. See "WhatsApp alerts" below.
- **More than one provider**: each `NOTIFICATION_<CHANNEL>_PROVIDER` takes one name or a
  comma-separated list, first choice first (`http,log`). A send moves to the next provider only
  when the one before cannot send now (unreachable, rate limited, sender or account blocked),
  never when the message or the number was refused. Every listed provider needs its own
  settings, an unknown or repeated name stops the service at start-up, and `log` anywhere in a
  list is refused in production. An SMS provider with no registered template for a message is
  passed over for it.
- **Redis**: the notification service needs `REDIS_URL`, the same Redis as the api-gateway. The
  per-sender rate limit and the circuit breakers live there (`docs/architecture.md` →
  "Notifications"); the service does not start without it.
- **Institute portal address**: the notification service also reads `INSTITUTE_PORTAL_URL` and
  prints `<url>/login` in the sign-in details sent to new institute users (ROV-315). Set it to the
  same value as the api-gateway's.

### Delivery canary and alerts

Every 15 minutes the notification service sends a test message (the canary, type
`DELIVERY_CANARY`) on each channel listed, through the same providers as every message
(ROV-329). The eight `notification_*` alerts in `docker/openobserve/alerts/` page when the
canary stops reaching the provider, the failure rate rises, a sender is blocked, a circuit
breaker opens, events wait or the service stops; [Notification delivery alerts](runbooks/notification-delivery.md) says what
to check for each.

| Variable | Value |
| --- | --- |
| `NOTIFICATION_CANARY_CHANNELS` | The channels to test, comma-separated. Production: `EMAIL,PUSH,SMS,WHATSAPP`. Unset turns the canary off and removes its Temporal schedule |
| `NOTIFICATION_CANARY_USER_ID` | Required with a channel: the id of the platform user the canary is addressed to (an existing `users` row) |
| `NOTIFICATION_CANARY_EMAIL` | Required with `EMAIL`: the mailbox that receives it |
| `NOTIFICATION_CANARY_PHONE` | Required with `SMS` or `WHATSAPP`: the phone in E.164 (`+91…`) |

The service refuses to start when a listed channel has no address or no
`NOTIFICATION_<CHANNEL>_PROVIDER`. What each channel needs besides:

- **Email**: the email provider settings above.
- **Push**: the canary user signed in on a device with notifications allowed, so that user has a
  registered device token; the canary goes to that user's own devices.
- **SMS**: the template id `DELIVERY_CANARY:<language>` in `SMS_TEMPLATE_IDS`, for the canary
  user's language. Without it every canary is skipped (`no_template`).
- **WhatsApp**: an active platform sender (admin portal, messaging senders) and the template
  `delivery_canary_v2` approved by the provider in the canary user's language.

SMS and WhatsApp are charged per message: about 96 canaries a day on each.

- The canary is critical: quiet hours and consent do not apply. It is recorded in
  `notification_deliveries` with scope `platform`; it is left out of the WhatsApp and SMS usage
  reports and of every institute's delivery log, and it counts towards the platform sender's
  own daily cap but never towards an institute's share.
- The schedule `notification-delivery-canary` is created or updated when a notification service
  with `NOTIFICATION_WORKER_ENABLED=true` starts, and removed when the variable is unset.
- **Outside the repository**: an uptime check from outside the server on `GET /api/health`
  (OpenObserve runs on the same server, so it cannot report the server down), and a paging
  route for `page` alerts. Both are configured in the providers' consoles.

## WhatsApp alerts

WhatsApp messages go out through the official business API (ROV-319), from a **sender**: a
number registered with the provider. An institute's messages use its own active sender when it
has one, else the platform's sender. When the institute's own sender cannot send now (blocked,
rate limited, unreachable), the same message goes through the platform's active sender, unless
the person stopped messages from that number or it is over its cap. Nothing is sent until a
sender exists.

**Environment**

| Variable | App | Meaning |
|----------|-----|---------|
| `NOTIFICATION_WHATSAPP_PROVIDER=cloud` | notification-service | Turns the provider on. The four below are then required |
| `WHATSAPP_API_BASE_URL` | notification-service | Address of the provider's API including its version segment; a message is posted to `<base>/<number id>/messages` |
| `WHATSAPP_APP_SECRET` | notification-service | Signs the provider's webhook calls |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | notification-service | Any long random string; typed again at the provider when the webhook address is registered |
| `MESSAGING_ENCRYPTION_KEY` | notification-service and api-gateway | 64 hex characters (`openssl rand -hex 32`), the same value in both apps. Encrypts each sender's access token in `messaging_sender_secrets`. Losing it means registering every token again. Unless `NODE_ENV` is `development` or `test`, the gateway refuses to start without it, and both apps refuse the all-zero development key |

**Webhook.** Route `GET` and `POST /webhooks/whatsapp` of a public host to the notification
service, and nothing else of that service. Register the address with the provider for the
`messages` field. Every call is checked against `WHATSAPP_APP_SECRET` over the raw body before
it is parsed; a call that fails the check gets 401 and changes nothing. The proxy must pass the
body through unchanged.

**Templates.** A business may start a conversation only with a template approved in advance.
Register every template in `apps/notification-service/src/delivery/whatsapp/whatsapp-templates.ts`
(the definitions sit beside each type under `apps/notification-service/src/types/`) with the same
name, the languages `en` and `hi`, the category, the body text exactly as written there, and one
"visit website" button whose address is the institute portal address followed by `{{1}}`. A type
without an approved template is recorded as skipped (`no_template`); a template the provider
does not know fails as `WA_TEMPLATE_REJECTED`.

**Senders.** A platform admin registers a sender with the GraphQL mutation
`adminRegisterMessagingSender` (the provider's number id, the display number, the access token,
the daily cap, and for the platform's sender the share one institute may use of it). The token
is encrypted on arrival, and no query returns it. `adminPauseMessagingSender`,
`adminBlockMessagingSender` and `adminActivateMessagingSender` switch a sender off and on;
`adminRotateMessagingSenderToken` replaces the token. `adminWhatsAppUsage(month)` counts the
messages each institute sent in a month by template category.

**Rules applied to every WhatsApp send**, in this order after the institute setting and consent:

1. No active sender: skipped (`no_provider`). No approved template: skipped (`no_template`).
2. The person's latest request to that number was STOP (or a Hindi equivalent): skipped
   (`opted_out`). This stops every WhatsApp message, security alerts included; those still go
   by email, push and in the app. Sending START lifts it. A request belongs to the number, so
   it survives the sender being removed and registered again.
3. Quiet hours, 21:00 to 07:00 in the institute's timezone: a non-critical message waits until
   07:00. Critical messages (security alerts) are sent at once.
4. The sender reached its daily cap in the last 24 hours, or the institute reached its share of
   the platform's sender: a non-critical message is skipped (`sender_cap`), a critical one waits
   and tries again every hour.
5. The sender's rate: at most `messagesPerSecond` messages in any second (default 10, 1 to
   1000), and one message per person every 6 seconds. A message over it waits for a free slot
   (`rate_limited`). Set the rate the provider allows the number, on the admin Monitoring page
   (pencil beside the sender) or through `adminUpdateMessagingSender`.
6. The sender's circuit breaker is open after repeated failures or a block: the message goes
   through the platform's sender, else waits (`provider_paused`). A sender the provider blocked
   is set `BLOCKED`; `adminActivateMessagingSender` turns it back on and clears its breaker.

Push and email go first, then WhatsApp. STOP and START are each confirmed once. A person who
writes anything else to a sender's number gets one fixed reply a day saying the number only sends alerts; the text of what they wrote is not stored.
There is no inbox.

## SMS

SMS goes out through a provider's HTTP API for registered templates (ROV-318). In India every
commercial SMS must match a template registered in advance, per language, so the service sends
a registration id and variable values, never free text. Today SMS carries only one-time codes
and the temporary password of a new account.

**Environment (notification service)**

| Variable | Meaning |
|----------|---------|
| `NOTIFICATION_SMS_PROVIDER=http` | Turns the provider on. The next four are then required |
| `SMS_API_BASE_URL` | Address of the provider's API; a message is posted to `<base>/flow` |
| `SMS_API_KEY` | The provider's key, sent in the `authkey` header |
| `SMS_TEMPLATE_IDS` | A JSON object from `<TEMPLATE_KEY>:<language>` to the provider's id of that registered template, for example `{"USER_WELCOME:en":"…","USER_WELCOME:hi":"…"}` |
| `SMS_WEBHOOK_SECRET` | At least 32 random characters (`openssl rand -hex 32`); part of the delivery-report address |
| `SMS_SENDER_ID` | Optional: the registered sender header, when the provider's template does not fix it |

**Templates.** Register each template in `apps/notification-service/src/delivery/sms/sms-templates.ts`
(the definitions sit in `apps/notification-service/src/types/secret.types.ts`) with exactly the
text written there, in `en` and `hi`, replacing `{{1}}`, `{{2}}`, … by the registry's variable
marker, and create the provider's template with variables named `var1`, `var2`, … in the same
order. A type or language with no id in `SMS_TEMPLATE_IDS` is recorded as skipped
(`no_template`). No template carries a web address.

**Variables.** A value longer than 30 characters is shortened and ends in `..`. A code, a
password or a username is never shortened: when one does not fit, the message is recorded as
failed (`SMS_VARIABLE_TOO_LONG`) and nothing is sent.

**Delivery reports.** Register `POST https://<public host>/webhooks/sms/<SMS_WEBHOOK_SECRET>`
with the provider and route that path to the notification service. The provider cannot sign
its calls, so the secret in the address is the only check: a call without it gets 401 and
changes nothing. The request log replaces that part of the address. A report can only add a
`DELIVERED` or `FAILED` row to a message the service sent; the institute comes from that
message, never from the report. Where the proxy can, also allow only the provider's addresses.

**Usage.** `adminSmsUsage(month)` counts the SMS each institute sent in a month, by type.

## PDF generation

Transfer certificates and other certificates are rendered inside the api-gateway with Typst
(`@myriaddreamin/typst-ts-node-compiler`). No browser or system binary is needed.

- The package ships one native binary per platform as an optional dependency. The image must
  be installed on the platform it runs on (`pnpm install` inside the image), not copied from a
  different one.
- Fonts are in the build output at `dist/apps/api-gateway/src/assets/fonts` (Noto Sans and Noto
  Sans Devanagari). Text in a script without a font is refused with `PDF_UNSUPPORTED_SCRIPT`
  instead of being printed as boxes; to add a script see `apps/api-gateway/src/assets/fonts/README.md`.
- `INSTITUTE_PORTAL_URL` must be the public address of the institute portal
  (`https://app.roviq.com`). It is printed in the QR code of every transfer certificate as
  `<url>/verify/tc/<token>`. A certificate printed with the wrong address cannot be fixed later.
- The page `/verify/tc/<token>` and the `verifyTC` query are public on purpose.

## Redis

Redis is on the request path for access control, not only for caching:

- `ResellerAccessGuard` (ROV-97) reads `auth:reseller-access:<id>` on every reseller-scope request, and suspension writes a block marker there. If Redis is unreachable these requests fail rather than skip the check.
- The same guard reads `auth:reseller-member-access:<membershipId>` (ROV-185). A role change, a deactivation and a tier change write the role the member's tokens must carry (or `blocked`) there for 11 minutes, one minute longer than a reseller access token lives. If the key is lost early, a token issued before the change keeps its old role until it expires (at most 10 minutes); refresh tokens are unaffected because the database checks the membership.
- `ImpersonationSessionGuard` reads `impersonation-session:<id>` and its tombstone on every impersonated request.
- `InstituteAccessGuard` reads `auth:institute-access:<id>` on every institute-scope request; a status change or delete writes a block marker there.
- `TokenVersionGuard` reads `auth:token-version:<userId>` on every authenticated request. A password change writes the new version there, which ends the access tokens issued before it at once. If the key is lost the guard reads `users.token_version` from the database, so nothing is let through wrongly.
- One-time impersonation codes, impersonation OTP requests, pending email verification codes and ws-tickets live only in Redis.
- The notification service keeps each sender's rate count and every circuit breaker in Redis (`notification:*` keys). While Redis is unreachable it sends nothing: workflow sends are retried by Temporal, codes and temporary passwords sent at once fail.

Plan Redis availability with that in mind; a Redis outage blocks every signed-in request.

## Impersonation OTP delivery

Reseller impersonation (and platform impersonation into an institute that requires consent) sends a 6-digit code to the institute admin's primary phone through the notification service (`NOTIFICATION.auth.security`). An institute whose admin has no primary phone cannot be impersonated by a reseller: the request is refused with `IMPERSONATION_CONSENT_UNAVAILABLE`. Make sure institute admins have a primary phone on file, and that the notification service's SMS channel is configured.
