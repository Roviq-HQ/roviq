# Certificates & Transfer Certificates

## Overview

The certificates module (Linear issue **ROV-170**) provides the institute-scoped workflow for issuing Transfer Certificates (TCs), duplicate TCs, and other admission-related certificates (bonafide, character, migration, etc.). The primary users are institute principals and office clerks handling student exits and certificate requests from parents. Workflow is state-machine driven (`requested → approved → issued` with `rejected` as a terminal alternate) and every transition is audited. Groups (JsonLogic-based dynamic student cohorts) are scaffolded in the database but the frontend surface is not yet built.

## Routes

| Route | Component | Purpose | CASL ability |
|-------|-----------|---------|--------------|
| `/institute/certificates/tc` | [page.tsx](<../../apps/web/src/app/[locale]/institute/(dashboard)/certificates/tc/page.tsx>) | TC register list with status filters | `read TC` |
| `/institute/certificates/tc/[id]` | [[id]/page.tsx](<../../apps/web/src/app/[locale]/institute/(dashboard)/certificates/tc/[id]/page.tsx>) | TC detail + approve/reject/issue actions | `read TC` |
| `/institute/certificates/other` | [other/page.tsx](<../../apps/web/src/app/[locale]/institute/(dashboard)/certificates/other/page.tsx>) | Other certificates (bonafide, character and the rest): list, request and download | `read Certificate` |

## GraphQL surface

| Operation | Type | Returns | CASL guard |
|-----------|------|---------|------------|
| `listTCs` | Query | `TCConnection` | `read TC` |
| `getTCDetails` | Query | `TC` | `read TC` |
| `requestTC` | Mutation | `TC` | `create TC` |
| `requestDuplicateTC` | Mutation | `TC` | `create TC` |
| `approveTC` | Mutation | `TC` | `update TC` |
| `rejectTC` | Mutation | `TC` | `update TC` |
| `issueTC` | Mutation | `TC` | `update TC` |
| `listCertificates` | Query | `CertificateConnection` | `read Certificate` |
| `getCertificate` | Query | `Certificate` | `read Certificate` |
| `listCertificateTemplates` | Query | `[CertificateTemplateModel]` | `read Certificate` |
| `requestCertificate` | Mutation | `Certificate` | `create Certificate` |
| `issueCertificate` | Mutation | `Certificate` | `update Certificate` |

Resolvers live under [apps/api-gateway/src/institute/certificate/](<../../apps/api-gateway/src/institute/certificate/>) decorated with `@InstituteScope()`. Status transitions are exposed as named domain mutations — no raw `updateTC(id, { status })`.

## Database schema

- [`tc_register`](<../../libs/database/src/schema/admission/tc-register.ts>) — TC serial number, student FK, reason, status enum, issue date, duplicate flag. Serials are `TC/{academic year label}/NNNN` (for example `TC/2025-26/0001`). The counter restarts each academic year, and the year label keeps serials unique per tenant ([tc-serial.ts](<../../apps/api-gateway/src/institute/certificate/tc-serial.ts>)). The issued PDF is `pdf_file_id`; `verification_token` (unique) is the token in the QR code.
- [`issued_certificates`](<../../libs/database/src/schema/admission/issued-certificates.ts>) — certificate instances with template FK, serial number and `pdf_file_id` (the rendered PDF in the `files` table; there is no URL column).
- [`certificate_templates`](<../../libs/database/src/schema/admission/certificate-templates.ts>) — tenant-configurable templates (bonafide, character, migration). The issue dialog lists the institute's active templates of the chosen type by name (`listCertificateTemplates`); when that list fails to load it shows the translated error with **Try again**, never "no templates". `requestCertificate` refuses a deactivated template with `CERTIFICATE_TEMPLATE_INACTIVE`; certificates already issued from it still render. No screen creates or edits templates.
- [`groups`](<../../libs/database/src/schema/groups/groups.ts>) — dynamic student cohort definitions (API in `apps/api-gateway/src/institute/group/`).
- [`group_rules`](<../../libs/database/src/schema/groups/group-rules.ts>) — JsonLogic rule rows per group.
- [`group_members`](<../../libs/database/src/schema/groups/group-members.ts>) — materialized membership rows.
- [`group_children`](<../../libs/database/src/schema/groups/group-children.ts>) — group composition / nesting.

All tables spread `tenantColumns` and use `tenantPolicies()` for RLS.

## PDFs and public verification (ROV-211)

- PDFs are rendered with Typst inside the api-gateway ([certificate-pdf.service.ts](<../../apps/api-gateway/src/institute/certificate/certificate-pdf.service.ts>)); no browser is involved. The result is stored through the file storage core and returned as a `FileRef`.
- Text in a script with no bundled font is refused with `PDF_UNSUPPORTED_SCRIPT`. Fonts: `apps/api-gateway/src/assets/fonts/README.md`.
- Every TC prints a QR code to `<INSTITUTE_PORTAL_URL>/verify/tc/<token>`. The page ([verify/tc/[token]/page.tsx](<../../apps/web/src/app/[locale]/institute/verify/tc/[token]/page.tsx>)) and the `verifyTC` query ([public-verification/](<../../apps/api-gateway/src/public-verification/>)) are public on purpose.
- Production needs: `docs/deployment.md` → "PDF generation".

## Multi-language names

Student name snapshots are stored as `i18nText` jsonb; a template's `name` is plain text. The TC PDF renderer picks the tenant's default locale for the issued copy and falls back through `current → en → first available`. Forms use `<I18nInput>` + `i18nTextSchema`. Searching the TC register by student name uses `search_vector @@ plainto_tsquery('simple', query)` joined onto the student profile row.

A certificate in `listCertificates` and `getCertificate` carries the student's name and admission number (`studentFirstName`, `studentLastName`, `studentAdmissionNumber`), joined from the institute's own profile copy; they are null for a staff certificate or a student the institute can no longer read, and the list then shows "Unknown student".

## Frontend patterns

- DataTable with `stickyFirstColumn` + `skeletonRows={8}` ([IXABI], [IMUXO])
- WindowedPagination with `1–25 of 243` window + page-size selector ([INREX])
- nuqs URL state for status, date range, template type filters ([JSUFS])
- Floating bottom-sticky bulk action bar for bulk approve/reject ([JABGL])
- Optimistic concurrency via `version` field on status transitions
- DD/MM/YYYY date format for issue date, leaving date ([GYATP])
- `<EntityTimeline>` on detail page for the audit tab showing every transition
