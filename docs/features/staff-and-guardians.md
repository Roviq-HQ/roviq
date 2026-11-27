# Staff & Guardians

## Overview

The staff and guardians module (Linear issue **ROV-169**) provides the institute-scoped CRUD surface for employees (teaching and non-teaching staff, their qualifications) and guardians (parents, legal guardians, emergency contacts) linked to students. The primary users are institute HR admins, receptionists, and principals managing staff onboarding, as well as admission clerks linking guardians to admitted students. All data is tenant-scoped via `withTenant()` and governed by RLS — only `user_profiles` reads cross into `withAdmin()` for joined reads.

## Routes

| Route | Component | Purpose | CASL ability |
|-------|-----------|---------|--------------|
| `/institute/people/staff` | [page.tsx](<../../apps/web/src/app/[locale]/institute/(dashboard)/people/staff/page.tsx>) | Staff list with filters & search | `read Staff` |
| `/institute/people/staff/new` | [new/page.tsx](<../../apps/web/src/app/[locale]/institute/(dashboard)/people/staff/new/page.tsx>) | Hire staff wizard | `create Staff` |
| `/institute/people/staff/[id]` | [[id]/page.tsx](<../../apps/web/src/app/[locale]/institute/(dashboard)/people/staff/[id]/page.tsx>) | Staff detail tabs (Profile, Qualifications, Documents, Audit) | `read Staff` |
| `/institute/people/guardians` | [page.tsx](<../../apps/web/src/app/[locale]/institute/(dashboard)/people/guardians/page.tsx>) | Guardian list | `read Guardian` |
| `/institute/people/guardians/new` | [new/page.tsx](<../../apps/web/src/app/[locale]/institute/(dashboard)/people/guardians/new/page.tsx>) | Add guardian | `create Guardian` |
| `/institute/people/guardians/[id]` | [[id]/page.tsx](<../../apps/web/src/app/[locale]/institute/(dashboard)/people/guardians/[id]/page.tsx>) | Guardian detail + linked students | `read Guardian` |

## GraphQL surface

| Operation | Type | Returns | CASL guard |
|-----------|------|---------|------------|
| `listStaff` | Query | `StaffConnection` | `read Staff` |
| `getStaffMember` | Query | `Staff` | `read Staff` |
| `createStaffMember` | Mutation | `Staff` | `create Staff` |
| `updateStaffMember` | Mutation | `Staff` | `update Staff` |
| `deleteStaffMember` | Mutation | `Boolean` | `delete Staff` |
| `listStaffQualifications` | Query | `[StaffQualification!]!` | `read Staff` |
| `createStaffQualification` | Mutation | `StaffQualification` | `update Staff` |
| `updateStaffQualification` | Mutation | `StaffQualification` | `update Staff` |
| `deleteStaffQualification` | Mutation | `Boolean` | `update Staff` |
| `listGuardians` | Query | `GuardianConnection` | `read Guardian` |
| `getGuardian` | Query | `Guardian` | `read Guardian` |
| `createGuardian` | Mutation | `Guardian` | `create Guardian` |
| `updateGuardian` | Mutation | `Guardian` | `update Guardian` |
| `deleteGuardian` | Mutation | `Boolean` | `delete Guardian` |
| `linkGuardianToStudent` | Mutation | `StudentGuardianLink` | `update Guardian` |
| `unlinkGuardianFromStudent` | Mutation | `Boolean` | `update Guardian` |
| `listLinkedStudents` | Query | `[Student!]!` | `read Guardian` |
| `listStudentGuardians` | Query | `[Guardian!]!` | `read Student` |
| `revokeGuardianAccess` | Mutation | `GuardianLink` | `manage Guardian` |
| `restoreGuardianAccess` | Mutation | `GuardianLink` | `manage Guardian` |
| `resendStaffSignInDetails` | Mutation | `Boolean` | `update Staff` |
| `resendGuardianSignInDetails` | Mutation | `Boolean` | `update Guardian` |

Deleting a staff member or a guardian also ends the person's membership of the institute when it
was the last profile that used it, and restoring brings the same membership back. A caller
cannot delete their own record this way (`CANNOT_REMOVE_OWN_MEMBERSHIP`), and the institute's
only admin cannot be removed (`LAST_ADMIN_CANNOT_BE_REMOVED`). Rules: `docs/auth.md` →
"Leaving an institute".

`createStaffMember` writes the account first (the user and its phone in one transaction, then its
profile), then the membership, the institute's profile copy and the staff profile in one institute
transaction. Refusals in this order:

1. A typed `employeeId` a current staff member of the institute holds: `EMPLOYEE_ID_DUPLICATE`.
2. No Teacher role in the institute: `ROLE_NOT_FOUND`.
3. An email that is already an account's: `EMAIL_TAKEN`.

The first two are checked before anything is written. `EMAIL_TAKEN` comes from the account
insert itself, whose transaction then writes nothing. When the institute transaction fails, or a
create racing this one took the typed ID in the meantime (the partial unique index
`uq_staff_profiles_tenant_employee_id` refuses the insert, again `EMPLOYEE_ID_DUPLICATE`), the
account is removed (`IdentityService.discardNewUser`), so a retry with the same email works.

A blank `employeeId` takes the next value of the institute's `employee_id` series (`EMP-0001`, …)
inside that transaction. A value a current staff member holds, or one a racing create commits
first, is skipped for the next, so a blank ID is never refused. A deleted row frees its ID, and
restoring it after the ID was reused answers `EMPLOYEE_ID_DUPLICATE`. `socialCategory` is saved
with the profile.

`createGuardian` with a `studentProfileId` reads the student under the caller's institute before
it creates the account: an unknown student answers `STUDENT_NOT_FOUND` and nothing is created
or sent.

`Staff.signInStatus` / `Guardian.signInStatus` and `signInDetailsSentAt` show whether the person has signed in or was sent their details; the lists and detail pages show them with a "Send sign-in details" button. Rules: `docs/auth.md` → "Sign-in details for staff and guardians".

Resolvers live under [apps/api-gateway/src/institute/staff/](<../../apps/api-gateway/src/institute/staff/>) and [apps/api-gateway/src/institute/guardian/](<../../apps/api-gateway/src/institute/guardian/>), decorated with `@InstituteScope()`.

## Database schema

- [`staff_profiles`](<../../libs/database/src/schema/user-profiles/staff-profiles.ts>) — employee code, department, designation, status enum.
- [`staff_qualifications`](<../../libs/database/src/schema/user-profiles/staff-qualifications.ts>) — degrees, institutions, years.
- [`guardian_profiles`](<../../libs/database/src/schema/user-profiles/guardian-profiles.ts>) — relationship enum, occupation, portal access flag.
- [`student_guardian_links`](<../../libs/database/src/schema/user-profiles/student-guardian-links.ts>) — many-to-many link table with `isPrimaryContact`, `isEmergencyContact`, `canPickup`, `livesWith`, and `accessRevokedAt` / `accessRevokedBy` (see "Revoking and restoring access").
- [`tenant_user_profiles`](<../../libs/database/src/schema/user-profiles/tenant-user-profiles.ts>) — the institute's own copy of the person's name, gender, date of birth and picture; joined on user and tenant. `user_profiles` is the account-level profile and is not read here (see `docs/auth.md` → "People and phone numbers").

All tables spread `tenantColumns`; `student_guardian_links` uses `tenantPolicies()` for RLS.

## Multi-language names

Staff and guardian `firstName`/`lastName` are stored as `i18nText` jsonb (`{ "en": "Priya", "hi": "प्रिया" }`). Forms use `<I18nInput>` with the `i18nTextSchema` (English required, other locales optional per tenant `supportedLocales`). Reads resolve via `useI18nField()` with the `current → en → first available` fallback. Cross-locale search runs through `search_vector @@ plainto_tsquery('simple', query)`, so searching `"प्रिया"` returns the same row as `"Priya"`.

## Frontend patterns

- DataTable with `stickyFirstColumn` + `skeletonRows={8}` ([IXABI], [IMUXO])
- WindowedPagination with `1–25 of 243` window + page-size selector ([INREX])
- nuqs URL state for every filter — department, designation, status ([JSUFS])
- Floating bottom-sticky bulk action bar for staff status transitions ([JABGL])
- Optimistic concurrency via `version` field on `updateStaffMember` / `updateGuardian`
- DD/MM/YYYY date format for joining date, DOB ([GYATP])
- `<EntityTimeline>` for the audit tab

## Guardian ↔ student linking

Guardian/student links are created in the UI from either side of the
relationship — the two entry points hit the same `linkGuardianToStudent`
mutation and refetch both list queries, so whichever page the user is on
updates in place.

Two entry points:

- **Guardian detail → Children tab** — `LinkStudentDialog` in [guardians/[id]/page.tsx](<../../apps/web/src/app/[locale]/institute/(dashboard)/people/guardians/[id]/page.tsx>). Picker query: `StudentsForGuardianPicker`. Test-id root: `guardian-detail-link-student-*`.
- **Student detail → Guardians tab** — `LinkGuardianDialog` in [students/[id]/page.tsx](<../../apps/web/src/app/[locale]/institute/(dashboard)/people/students/[id]/page.tsx>). Picker query: `GuardiansForStudentPicker`. Test-id root: `student-detail-link-guardian-*`.

Both dialogs share the same UX contract:

- **CASL-gated CTA** — the "Link student" / "Link guardian" button is
  wrapped in `<Can I="update" a="Guardian">`, matching the backend
  resolver guard. Read-only roles never see the button.
- **Searchable picker** — debounced 250ms via
  [use-debounced-value.ts](<../../apps/web/src/hooks/use-debounced-value.ts>),
  and the picker `useQuery` is `skip: !open` so it stays idle until the
  dialog opens. Already-linked entities are filtered out client-side as
  defense-in-depth; the unique constraint on `student_guardian_links` is
  the authoritative gate.
- **Relationship Select** — one of the 9 `GuardianRelationship` enum
  values. Labels live under `detail.children.relationships.*` (guardian
  side) and `detail.guardians.relationships.*` (student side).
- **Four link-metadata toggles** — `isPrimaryContact`,
  `isEmergencyContact`, `canPickup`, `livesWith`. The primary toggle
  surfaces an amber demotion warning (the backend clears any existing
  primary contact for that student when a new one is linked).
- **Shared mutation** — `useLinkGuardianToStudent()` in
  [use-guardians.ts](<../../apps/web/src/app/[locale]/institute/(dashboard)/people/guardians/use-guardians.ts>)
  is imported by both pages. It refetches
  `InstituteGuardianLinkedStudents` + `InstituteStudentGuardians` with
  `awaitRefetchQueries: true`, so the new row is visible the instant the
  dialog closes.

### Unlinking

Both tabs show an **Unlink** button per link (`UnlinkGuardianButton` in
[unlink-guardian-dialog.tsx](<../../apps/web/src/app/[locale]/institute/(dashboard)/people/unlink-guardian-dialog.tsx>),
gated by `update Guardian`). The dialog reads the student's guardians first, so the rules
`unlinkGuardianFromStudent` enforces are visible before submitting:

- **Only guardian** — Unlink is disabled with an explanation (`LAST_GUARDIAN_CANNOT_BE_DELETED`).
- **Primary contact** — the user must pick the new primary contact from the student's other
  guardians (`newPrimaryGuardianId`). The server rejects a replacement that is not another live
  guardian of that student or whose access is revoked (`REPLACEMENT_PRIMARY_GUARDIAN_INVALID`),
  and a replacement sent when the unlinked guardian is not the primary.
- The service locks the student's live links (`FOR UPDATE`), soft-deletes the link and promotes the
  replacement in **one transaction**, then emits `GUARDIAN.unlinked`. Links whose guardian profile
  is deleted do not count as another guardian, in unlink and in `deleteGuardian`.

### Revoking and restoring access

`revokeGuardianAccess` closes one guardian's access to one student (a separation, a custody
order) and keeps the link on the student's record. It sets `access_revoked_at` and
`access_revoked_by` and clears `can_pickup` and `is_primary_contact`. A CHECK keeps a revoked link
from being the primary contact. `restoreGuardianAccess` clears the two columns; pickup and primary
contact are not given back. Both need `manage Guardian`.

A revoked link gives the guardian nothing for that student, and their other children are
unaffected:

| Where a link becomes access | Code |
|---|---|
| The guardian's permissions (`linkedStudentIds`: student, attendance, report cards, leave, consent) | `MembershipAbilityDrizzleRepository.findReadAssignments` |
| Consent grant, withdraw and status | `ConsentDrizzleRepository.isGuardianLinkedToStudent`, `latestForGuardian` |
| The children listed on the guardian's own profile | `ProfileDrizzleRepository.listGuardianChildren` |
| Messages about the student, and whose consent a message needs | `RecipientReadDrizzleRepository`, `ConsentReadDrizzleRepository` (notification-service) |

Staff still see the link: the Guardians tab of the student page shows an **Access revoked** badge
and a **Restore access** button (`GuardianAccessButton` in
[guardian-access-dialog.tsx](<../../apps/web/src/app/[locale]/institute/(dashboard)/people/guardian-access-dialog.tsx>));
a link with access shows **Revoke access**. Lists, exports and certificates keep reading the link.
A new read of `student_guardian_links` that gives the guardian something must filter
`access_revoked_at IS NULL`.

### Linked-person popup

Every linked student or guardian name (guardian Children tab, student Guardians tab, the student
list's primary-guardian column) is a `PersonNameLink` from
[person-detail-dialog.tsx](<../../apps/web/src/app/[locale]/institute/(dashboard)/people/person-detail-dialog.tsx>).
It opens the same `StudentDetailView` / `GuardianDetailView` the detail routes render, inside a
Dialog (Sheet below `lg`), without leaving the page. Names inside the popup swap its content and
add a **Back** step; **Open full page** goes to the route. `people/layout.tsx` mounts the provider.
In the popup the views hide the back button and breadcrumbs, a delete returns to the previous
popup step, and the student Attendance tab keeps its date range in local state instead of the URL.
