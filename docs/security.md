# Security overview

How Roviq keeps one institute's data away from another and controls who can do what. This page is
a summary for someone evaluating Roviq; each row links to the document that holds the detail.

## Tenant isolation

Many institutes share one database. The database, not the application, keeps them apart.

| Control | How it works | Detail |
|---------|--------------|--------|
| Row-level security | Every table that holds an institute's data has PostgreSQL row-level security, forced even for the table owner. A query sees only the rows of the institute named in the transaction. Two account tables with no institute column (sign-in providers, phone numbers) are protected by grants instead | [Architecture](architecture.md#multi-tenancy-rls-over-schema-per-tenant) |
| Separate database roles | The app logs in as a role with no data access, and each request switches to the role of its scope: institute, reseller or platform. No role bypasses row-level security | [Infrastructure](infrastructure.md#database) |
| Rules in the database | Security rules are grants, policies, constraints and triggers where PostgreSQL can express them, so no code path can skip them. Tests attempt the forbidden write as each role | [Testing](testing.md#security-invariants) |
| Automated gates | A table without row-level security, or institute code that reaches platform-level access, fails the build | [Mistakes](references/mistakes.md) |
| A test per operation | Every institute and reseller operation that takes an id is listed with the test that sends it another institute's id and expects a refusal. An operation that is not listed fails the build; the operations not yet tested are counted, and the count may only go down | [Auth](auth.md#a-scope-guard-is-not-tenant-isolation-rov-290) |

## Sign-in and sessions

| Control | How it works | Detail |
|---------|--------------|--------|
| Passwords | Hashed with Argon2id. An account an institute creates gets a temporary password that must be changed at first sign-in; it is never stored in a log, an audit row or a notification record | [Auth](auth.md#first-login-password-change-rov-96) |
| Passkeys | A user can sign in with a passkey instead of a password | [Auth](auth.md) |
| Lockout | Five failed attempts in 15 minutes lock the username for 30 minutes (configurable) | [Auth](auth.md#brute-force-lockout-rov-209) |
| Short-lived tokens | Access tokens live 5 to 15 minutes by scope. Refresh tokens rotate on every use, and a replayed one ends all of the user's sessions | [Auth](auth.md#jwt-structure) |
| Session control | A user sees their active sessions and can end any of them. A password change ends them all | [Auth](auth.md#session-management) |

## Permissions

| Control | How it works | Detail |
|---------|--------------|--------|
| Three scopes | Platform, reseller and institute each have their own sign-in, API operations and database role. A token of one scope is refused by the others | [Auth](auth.md#scope-guards) |
| Role abilities | Every operation checks an ability (action and subject) held by the user's role in that institute. Abilities can carry conditions: a teacher's sections, a guardian's own children | [Auth](auth.md#casl-authorization) |
| Sensitive fields | Identity numbers, income and medical details are hidden from roles that do not need them | [Auth](auth.md#student-and-admission-reads) |

## Support access (impersonation)

Reseller and platform staff can open an institute as one of its users to give support.

- A reseller always needs a one-time code from the institute. Platform staff need one when the
  institute has asked for it.
- A session lasts 15 minutes and cannot be renewed. Staff whose own role is read-only get a
  view-only session.
- Every action in a session is in the audit log, and the institute can see it.

Detail: [Auth](auth.md#impersonation).

## Audit

- Every change is recorded with who, what and when, for all three scopes. The institute and
  reseller database roles can add entries and cannot change or delete them.
- An institute sees its own entries and the actions that resellers and platform staff took on it.
- Sign-ins, failed sign-ins, lockouts and session endings are recorded separately.

Detail: [Audit logging](features/audit-logging.md), [Auth](auth.md#auth-events-rov-96).

## Files

- No table stores a file URL and nobody gets storage credentials. The API reads the file's row
  under row-level security, then signs a link for that one file: 10 minutes, or 60 seconds on
  request for identity and academic documents.
- An uploaded image is never stored as sent: it is re-encoded and its metadata, GPS position
  included, is dropped.
- Other uploads (PDF, CSV, XLSX) can be scanned with ClamAV before they are attached to a record.
  Scanning is **off by default** and is switched on per deployment.

Detail: [Architecture](architecture.md#file-storage), [Deployment](deployment.md#malware-scanning-of-uploads).

## Personal data

- Each institute keeps its own copy of a person's name, details and picture; another institute the
  same person belongs to cannot read it.
- A guardian gets WhatsApp messages only while their consent for that purpose and that child is on
  record; withdrawing it applies to the next message.

Detail: [Auth](auth.md#people-and-phone-numbers-rov-292), [Deployment](deployment.md#notification-delivery).

## Reporting a vulnerability

Email security@nbb.ai. The policy is in [SECURITY.md](../SECURITY.md).

## What this page does not claim

Roviq is pre-release. This page describes controls that are in the code and covered by tests. It
is not an audit report or a certification.
