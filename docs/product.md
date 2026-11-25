# Product overview

What Roviq is, who uses it and what it does today. Every statement here describes something that
is built; work that is planned is tracked in
[GitHub Issues](https://github.com/Roviq-HQ/roviq/issues).

## What it is

Roviq is institute management software: one system for the records, the daily routine and the
paperwork of an institute. It is built for India first: Indian boards, the NEP 2020 structure,
government report formats, English and Hindi.

It is multi-tenant. One installation serves many institutes, and each institute's data is kept
apart by the database itself ([security.md](security.md)).

**Status: pre-release.** Roviq is not running in production yet. The schema and the API can still
change without a migration path.

## Who it is for

| Institute type | Notes |
|----------------|-------|
| Pre-primary to senior secondary | The NEP 2020 or the traditional 10+2 structure |
| Coaching centre | No fixed class ladder; academic years may overlap |
| Library | Reading rooms and libraries |

Subject catalogues ship for CBSE, BSEH (Haryana) and RBSE (Rajasthan).

## Who uses it

Three portals, one per kind of user. All three are the same web app.

| Portal | Users | They do |
|--------|-------|---------|
| Institute | Administrators, principals, teachers, office staff, students, guardians | Run the institute day to day |
| Reseller | Partners who sell and support Roviq | Create and manage their institutes, plans and invoices, their own team |
| Admin | Roviq platform staff | Manage institutes and resellers, watch system health, audit |

An institute always belongs to one reseller. Institutes that buy directly belong to the built-in
reseller "Roviq Direct".

## What an institute gets

| Area | What is built | Details |
|------|---------------|---------|
| Setup | Academic years, standards, sections, subjects; institute profile and branding | [Institutes](features/institutes.md) |
| Admissions | Enquiries, applications, statistics | [Institute portal guide](user-guides/institute-portal.md) |
| Students | Records, documents, CSV import, enrolment, year-end promotion | [Students](features/students.md) |
| Staff and guardians | Staff and qualifications, guardians linked to their children, sign-in details sent on creation | [Staff and guardians](features/staff-and-guardians.md) |
| Attendance | Daily and per-period attendance, history, reports | [Attendance](features/attendance.md) |
| Leave and holidays | Leave requests with approval, the holiday calendar; both feed attendance | [Attendance](features/attendance.md) |
| Timetable | Weekly timetables, section and staff views, substitutions for a single date, print | [Timetable](features/timetable.md) |
| Examinations | Offline exams, marks entry, results with ranks, report cards, grading schemes | [Examinations](features/examinations.md) |
| Certificates | Transfer certificates with public verification, bonafide and other certificates as PDF | [Certificates](features/certificates.md) |
| Groups | Groups of people (class, section, house, club and others), filled by hand or by rules | `apps/api-gateway/src/institute/group/` |
| Government and board reports | Exports for UDISE+, CBSE, BSEH, Shala Darpan and RTE, and the TC and admission registers. Today they are produced from the Admin portal's institute page | [Deployment](deployment.md#background-workers) |
| Notifications | In-app inbox, email, push, SMS and WhatsApp (from the platform's number or the institute's own, with its message templates registered automatically); each institute chooses its channels and sees who received each notification, per channel | [Architecture](architecture.md#notifications) |
| Audit | Who did what and when, including actions by the reseller and by Roviq staff | [Audit logging](features/audit-logging.md) |
| Privacy | Consent records per guardian and purpose | [Deployment](deployment.md#notification-delivery) |

Across every area:

- **English and Hindi**, for the interface and for names an institute types in.
- **Roles and permissions**: default roles such as administrator, principal, teacher, student and
  guardian. A teacher sees only their sections, a guardian only their children.
- **Passkeys** as well as passwords, and a list of active sessions a user can end.
- **Works on a phone**: the layout adapts, with a bottom tab bar on small screens.

## What Roviq does not do yet

So that nobody is promised it:

- Fee collection from students. (The billing below is what an institute pays for Roviq.)
- Online examinations. Exams are held on paper; Roviq records the marks.
- Transport, hostel, library lending, payroll.
- A mobile app. The web app works in a phone browser.

## Editions

| | Community | Enterprise |
|---|-----------|------------|
| Code | Everything outside `ee/` | Adds `ee/` |
| Licence | [AGPL-3.0](../LICENSE) | [Business Source License 1.1](../ee/LICENSE): production use is allowed, offering it to others as a hosted service is not |
| Adds | | Subscription billing: plans, subscriptions, invoices, online payment through Razorpay or Cashfree, UPI ([billing](../ee/docs/billing.md)) |
| Switch | Default | `ROVIQ_EE=true` |

Enterprise billing is how a reseller charges its institutes for Roviq.

## Running it

- **To try it or develop it**: [Getting started](getting-started.md), one command.
- **In production**: [Deployment](deployment.md) lists what a deploy needs. There is no packaged
  installer yet.
