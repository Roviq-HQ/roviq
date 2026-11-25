# Student Management

## Overview

The student management module (Linear issue **ROV-167**) provides the institute-scoped CRUD, search, enrollment, and lifecycle surface for student records. The primary users are institute admins, receptionists, and class teachers who need to admit, enroll, edit, transition, and search students from the institute portal. All data is tenant-scoped via `withTenant()` and subject to RLS; platform admins access student rows via `withAdmin()` for cross-tenant operations only.

## Routes

| Route | Component | Purpose | CASL ability |
|-------|-----------|---------|--------------|
| `/institute/people/students` | [page.tsx](<../../apps/web/src/app/[locale]/institute/(dashboard)/people/students/page.tsx>) | Student list with filters, search, bulk actions | `read Student` |
| `/institute/people/students/new` | [new/page.tsx](<../../apps/web/src/app/[locale]/institute/(dashboard)/people/students/new/page.tsx>) | Admit new student wizard | `create Student` |
| `/institute/people/students/[id]` | [[id]/page.tsx](<../../apps/web/src/app/[locale]/institute/(dashboard)/people/students/[id]/page.tsx>) | Student detail tabs (Profile, Academics, Guardians, Documents, Fees, Audit) | `read Student` |
| `/institute/people/students/import` | [import/page.tsx](<../../apps/web/src/app/[locale]/institute/(dashboard)/people/students/import/page.tsx>) | Import students from a CSV file | `create Student` |

## GraphQL surface

| Operation | Type | Returns | CASL guard |
|-----------|------|---------|------------|
| `listStudents` | Query | `StudentConnection` | `read Student` |
| `getStudent` | Query | `Student` | `read Student` |
| `createStudent` | Mutation | `Student` | `create Student` |
| `updateStudent` | Mutation | `Student` | `update Student` |
| `deleteStudent` | Mutation | `Boolean` | `delete Student` |
| `transitionStudentStatus` | Mutation | `Student` | `update Student` |
| `listStudentAcademics` | Query | `[StudentAcademic!]!` | `read Student` |
| `listStudentGuardians` | Query | `[Guardian!]!` | `read Student` |
| `listStudentDocuments` | Query | `[UserDocument!]!` | `read Student` |
| `enrollStudent` | Mutation | `StudentAcademic` | `update Student` |
| `updateStudentSection` | Mutation | `StudentAcademic` | `update Student` |
| `setPromotionDecisions` | Mutation | `Int` (rows updated) | `update Student` |
| `changeStudentClass` | Mutation | `ID` (the year record) | `update Student` |
| `removeStudentFromYear` | Mutation | `Boolean` | `update Student` |
| `studentStatistics` | Query | `StudentStatistics` | `read Student` |
| `studentUpdated` | Subscription | `Student` | `read Student` |

Resolvers live under [apps/api-gateway/src/institute/student/](<../../apps/api-gateway/src/institute/student/>) and are decorated with `@InstituteScope()`.

## Database schema

- [`student_profiles`](<../../libs/database/src/schema/user-profiles/student-profiles.ts>) — core student row with admission no, status enum, `search_vector` for FTS.
- [`student_academics`](<../../libs/database/src/schema/user-profiles/student-academics.ts>) — per-academic-year enrollment (standard, section, roll number).
- [`student_guardian_links`](<../../libs/database/src/schema/user-profiles/student-guardian-links.ts>) — link table (read-only from student service; writes via guardian service).
- [`tenant_user_profiles`](<../../libs/database/src/schema/user-profiles/tenant-user-profiles.ts>) — the institute's own copy of the student's name, demographics and picture; joined on user and tenant. `user_profiles` is the account-level profile and is not read here (see `docs/auth.md` → "People and phone numbers").
- [`user_documents`](<../../libs/database/src/schema/user-profiles/user-documents.ts>) — joined via `withAdmin()` for Aadhar/birth cert uploads.

All tables spread `tenantColumns` and use `tenantPolicies()` for RLS + admin bypass + soft-delete filter.

## Creating a student

`createStudent` reads the academic year, the standard and the section under the caller's
institute before it writes anything: the standard must be of the year and the section of the
standard. Otherwise it answers `ACADEMIC_YEAR_NOT_FOUND`, `STANDARD_NOT_FOUND` or
`SECTION_NOT_FOUND` and no user, membership or profile is created.

Every student is a new account (users, phone, account profile, written as the platform role).
Then one institute transaction, [`admitStudent`](../../apps/api-gateway/src/institute/student/repositories/admit-student.ts),
writes everything else: it checks the year and class again (they can be deleted after the first
check), then inserts the membership, the institute's profile copy, the student profile with its
admission number and the first year record. A failure anywhere rolls all of it back. The account
made for it is then removed with `IdentityService.discardNewUser`, which deletes only an account
that has no membership of any scope and never changed its password. `createStudent`, bulk import
(one transaction per row, roll number included) and the admission workflow (one `admitStudent`
activity; a retry finds the account by the application's placeholder email and, after a
committed attempt, that attempt's student) all use it. The `STUDENT.admitted` event is emitted
only after the transaction commits.

`bulkCreateStudents` makes the same read before it claims the uploaded file or starts the
import workflow, with the same three codes. `deleteStudent` answers `STUDENT_NOT_FOUND` for a
student that is not in the institute.

## Admission numbers

Generated by [`nextAdmissionNumber`](<../../apps/api-gateway/src/institute/student/admission-number.sequence.ts>) for `createStudent`, the admission workflow and bulk import, inside the same transaction as the `student_profiles` insert. A failed admission rolls the counter back, so numbers have no gaps.

- `institute_configs.admission_number_config.prefixes` maps a standard's `numeric_order` to a prefix. Every distinct prefix is its own series (`tenant_sequences` row `adm_no:{prefix}`; `adm_no:` is the unprefixed series). For example, `{ "-3": "K-", "-2": "K-", "-1": "K-", "1": "K-" }` with `no_prefix_from_class: 2` gives `K-0001…` for Nursery–Class 1, and a separate `0001…` series from Class 2.
- `{prefix}`, `{year}` and `{value:0Nd}` in `format` are filled on every call, so `{year}` follows the current academic year. Counters don't reset per year.
- Institutes that issued numbers before per-prefix series (from the old shared `adm_no` counter) start each new series after that counter's value, so old numbers never repeat.

## Multi-language names

`firstName` and `lastName` are stored as `i18nText` jsonb (`{ "en": "Raj", "hi": "राज" }`). Forms use `<I18nInput>` from `@roviq/ui` with the `i18nTextSchema` from `common/validators.ts` (English required, other locales optional per tenant `supportedLocales`). Reads resolve via `useI18nField()` with fallback chain `current → en → first available`. Multilingual full-text search runs through `search_vector @@ plainto_tsquery('simple', query)`, indexed per student row so `"राज"` and `"Raj"` both resolve the same record.

## Frontend patterns

- DataTable with `stickyFirstColumn` + `skeletonRows={8}` ([IXABI], [IMUXO])
- WindowedPagination with `1–25 of 243` window + page-size selector ([INREX])
- nuqs URL state for every filter — standard, section, status, search ([JSUFS])
- Floating bottom-sticky bulk action bar for multi-select actions ([JABGL])
- Optimistic concurrency via `version` field passed to `updateStudent`
- DD/MM/YYYY date format via `useFormatDate()` ([GYATP])
- `<EntityTimeline>` for the audit tab consuming `auditLogs` query
- The Profile tab is a form only for roles with `update Student`. Other roles see it as text ([FVOLK]), with no local draft, and a field their role may not read is left out rather than shown empty: the server returns it as null ([`student-profile-read-only.tsx`](<../../apps/web/src/app/[locale]/institute/(dashboard)/people/students/[id]/student-profile-read-only.tsx>))

## Year-end promotion

1. **Record the result.** On the students list, select students and pick **Year-end result**
   in the bulk bar: Promote, Detain, Completed final class or Clear (back to undecided). This
   calls `setPromotionDecisions(input: { studentAcademicIds, status })` on the students'
   current-year rows: 1 to 500 ids, all or nothing (`STUDENT_ACADEMIC_NOT_FOUND` if any id is
   not a live row of this institute), `TRANSFERRED` refused. A status other than `PROMOTED`
   clears `promoted_to_standard_id`. The list shows a badge for Promoted, Detained and Completed.
2. **Preview.** Activating the next academic year opens a dialog that reads
   `academicYearRolloverPreview(academicYearId)` (`update AcademicYear`): how many students
   move up, stay, complete the final class, are not carried over or are already placed, and a
   warning for students whose class has no section in the new year. Below the counts a table
   has one row per section of the active year: its students, the section they go to, and that
   section's size after the rollover against the institute's hard limit
   (`sectionStrengthNorms.hardMax`, 45 when not set). The admin can pick another section of the
   same class for a whole section; the choice is saved at once with
   `setRolloverSectionMap(input: { academicYearId, entries: [{ fromSectionId, toSectionId }] })`
   (`update AcademicYear`; `toSectionId: null` goes back to the name rule) and is stored in
   `year_rollover_section_map` for the year being activated. Sections that would go over the
   limit are listed in a warning. The rollover places the students anyway: capacity never
   blocks an activation.
3. **Activate.** The `ACADEMIC_YEAR.activated` consumer places the students by the same rule
   (`docs/guides/events.md` → "Year-end promotion rule"). Undecided students move up one level
   (they stay in a COACHING institute); detained students stay; completed and transferred
   students get no row. Each student goes to the section the admin chose for their old
   section, else keeps their section name where the new class has it (5-B goes to 6-B),
   otherwise goes into the new class's first section.

Pre-primary classes use levels below 1 (Nursery -3, LKG -2, UKG -1; from -5), so they move
up into Class 1 like any other level. A section that still has students cannot be deleted
(`SECTION_HAS_STUDENTS`), and enrolling a student twice in one year fails with
`STUDENT_ALREADY_ENROLLED`.

## Section capacity warning

Every path that places a student in a section can send it:

- `enrollStudent`, `updateStudentSection` and `changeStudentClass` (`StudentAcademicService`);
- `createStudent` (`StudentService.create`);
- the admission workflow (`admitStudent` activity);
- bulk import (`insertBatch` activity), once per row.

The placement's own transaction locks the section row (`FOR NO KEY UPDATE`, as the
`refresh_section_strength` trigger does), reads `current_strength` and the optimal norm (the
institute's capacity norms, default 40) before the write, and `current_strength` again after it.
The trigger counts only `ENROLLED` students. Only when `before < optimal <= after` are
`SECTION.capacity_warning` and `NOTIFICATION.section.capacity_warning` emitted, after the
transaction commits (`section-norms.ts`). Concurrent placements take turns on the lock, so exactly
one of them crosses; placements above the optimal do not repeat it, and it comes again only after
the section drops below and refills.
notification-service (`SectionListener`) sends the in-app and push notification
`SECTION_CAPACITY_WARNING` to the section's active class teacher, else to every active member with
the `academic_coordinator` role; it links to the standard's sections
(`/institute/academics/<standardId>`). Neither is found: nothing is sent and a warning is logged.

## Correcting one student after a rollover

Three actions fix one student without touching anyone else (ROV-322).

- **Change class.** On the student page → Academics, the row of the active year has
  **Change class**. It calls `changeStudentClass(input: { studentAcademicId, standardId,
  sectionId, overrideReason })`: the class must belong to the same academic year as the record
  (`STANDARD_NOT_FOUND`), the section to that class (`SECTION_NOT_FOUND`); the same class and
  section is `VALIDATION_FAILED`; a full section is `SECTION_CAPACITY_EXCEEDED` until an
  override reason is given (the dialog asks for it only then). Last year's result follows in
  the same transaction: `PROMOTED` when the new class is higher than last year's (with
  `promoted_to_standard_id` set to the new class), `DETAINED` when it is the same level (target
  cleared), unchanged when lower or when last year's row is `TRANSFERRED`.
  Emits `STUDENT.section_changed` and `STUDENT.promoted`.
- **Place a student the rollover skipped.** The students list has a **Not placed in this year**
  filter (`listStudents(filter: { notPlacedInYearId })`, not combinable with `academicYearId`).
  It lists students who are still studying here (ENROLLED, PROMOTED, DETAINED, RE_ENROLLED),
  have a year record in an earlier year and none in the selected one; class and section show
  their last placement. Each row has **Enrol in this year**, which calls `enrollStudent`; the
  student page offers the same button when the student has no row in the active year.
  `enrollStudent` refuses a student or year of another institute (`STUDENT_NOT_FOUND`,
  `ACADEMIC_YEAR_NOT_FOUND`), a class outside the year (`STANDARD_NOT_FOUND`) and a section
  outside the class (`SECTION_NOT_FOUND`). A
  teacher's section-limited view finds nobody here, since nobody has a section in that year.
- **Remove from this year.** Next to Change class. `removeStudentFromYear(studentAcademicId,
  reason)` soft-deletes the year record (reason 3 to 500 characters, kept in the audit log as
  the mutation's arguments) and emits `STUDENT.removed_from_year`. It is refused with
  `STUDENT_YEAR_HAS_RECORDS` once the student has, in that year, a live attendance entry, exam
  mark, exam topic assessment, co-scholastic assessment or report card. The student then shows
  under **Not placed in this year** and can be enrolled again; a redelivered
  `ACADEMIC_YEAR.activated` does not place them back, because the rollover skips any row in
  the new year, deleted ones included.
