---
name: frontend-ux
description: Use when working on any frontend code, UI components, pages, forms, data tables, layouts, navigation, dashboards, or anything in the Next.js web app — covers UX patterns, accessibility, i18n, responsive design, real-time updates, and Indian user context
---

Before implementing any UI component, read the matching rule from the reference:
`sed -n '/\[TAGID\]/,/^---$/p' docs/references/frontend-ux.md`
This is mandatory, not optional — the reference contains problem context, edge cases, and implementation details that this file omits for brevity.

Users are Indian institute admins, clerks, teachers, parents — non-technical, on 1366×768/1920x1080 laptops or Android phones, unreliable 4G/5G.

## General

- [ABMVS] Data tables: nuqs (URL state) → TanStack Table (headless) → Apollo (paginated GraphQL) → shadcn/ui
- [ADQJE] Use `<Can>` from `@casl/react` for permission-gated UI — never manual `ability.can()` in JSX
- [AXPQY] Use `@roviq/ui` components only — never raw HTML elements. Missing component → create in `@roviq/ui` first
- [BUKTM] All user-facing text via `useTranslations()` from `next-intl` — zero hardcoded strings
- [BXWCX] `[locale]` route segments. Translations per-namespace in `messages/{locale}/`. New feature → new namespace JSON
- [CKWZY] `useFormatDate()`/`useFormatNumber()` from `@roviq/i18n` — never raw `Intl` or `toLocaleDateString()`
- [CLFYD] `Field`/`FieldLabel`/`FieldError`/`FieldGroup`/`FieldSet` for all forms — never legacy `form.tsx`
- [CSIIV] camelCase vars/fns, PascalCase components/types, kebab-case files, `@roviq/*` imports
- [DCACD] TS strict, ES2026. Exports top, privates bottom. >2 params → object. Export only what's used externally
- [DFHTL] Action buttons must have native `title` for hover help. `<Tooltip>` only when custom styling needed
- [TSTID] Every testable element (form field, action button, row, dialog, empty/error/loading state) gets a testid from the typed registry: `data-testid={testIds.<group>.<key>}` from `@roviq/ui/testing/testid-registry`, one source for app code and tests. Add new ids to the registry first. A literal `data-testid="…"` fails `pnpm check:testids`
- [GQLCG] GraphQL operations are `gql\`…\`` literals with generated types (`*.generated.ts` beside the file). After changing an operation or a resolver, regenerate (`pnpm tilt logs codegen`, or `pnpm codegen` with the gateway up) and commit the generated files; `pnpm check:codegen-drift` fails otherwise
- [ERRCP] Errors show translated copy chosen by `extensions.code` (`extractGraphQLErrorCode`, `isAppError`), never `err.message`. Every code an operation can return has copy in both `en` and `hi`
- [MUTRF] After a mutation the screen shows the new state without a reload: refetch the queries that list the changed data, or update the cache. Name refetched queries exactly as their operations are named
- [PRBMS] A message that reports a problem (alert, banner, failed or skipped status, "unavailable" state) says what happened, which one, who is affected now, one to three first steps, where to take them (button or link) and how it ends: `docs/frontend.md` → "Messages that report a problem"
- Check `docs/frontend.md` → "Common components" before building a picker, dialog or table part; add a line there for a new common component

## Forms

- [DNMPQ] Domain language labels, not DB names. Text around a field is one of three kinds: an instruction needed to fill it (format, limit, warning, error) goes in `description`, after the input, always shown; an optional one-sentence `hint` and the explanation (what, why, what each choice changes) go in a help topic in `apps/web/src/help/<area>/<form>.help.ts` (`defineFieldHelp`, en+hi together), passed as `help={…}` to the shared field or `FieldLabelWithInfo`. Nothing goes between a label and its input except the topic hint (`pnpm check:field-help`). A simple field gets no topic; a field needing more than the popover gets an `article`. Every topic lists the code it describes in `<form>.help.sources.ts`. Never inline `<Popover>`+`HelpCircle`. Format: `docs/frontend.md` → "Field help"
- [FJPME] Show min/max constraints. ₹ prefix + Indian numbering on blur. % suffix. Validate on blur
- [FLSCT] Limit fields: "2 of 10 used" inline. Warn before reducing below usage. Plan-gated → "Upgrade" link
- [FVOLK] Edit: read-only as plain text, creation metadata, "Save Changes" not "Submit"
- [FXPFP] 5+ fields → section. Wizards for setup. Tabs/accordion for edit. 4+ sections → sticky TOC
- [GGPVY] >10 items → cmdk combobox. Hierarchical → cascading. >100 → async search
- [GYATP] Academic year: "2025–26" selector. Dates: DD/MM/YYYY. Presets: "This Academic Year", "Last Term"
- [GZUFW] Phone: +91 prefix, 10-digit validate, format on blur. WhatsApp → icon + notification helper. Store E.164
- [HBCFO] Address: structured fields. Auto-fill city/state from PIN code. Board-filtered state dropdown
- [HQIEQ] Uploads: specific label with format/size/resolution. Drag-drop + preview. Client-side validation pre-upload
- [HUPGP] Auto-save drafts to localStorage every 30s + blur. Restore banner. Key: `roviq:draft:{form}:{id}`
- [HVJED] ₹1,00,000 not ₹100,000. `useFormatNumber()`. Paise BIGINT. Dashboard: "₹1.2L", "₹3.5Cr"

## Data Tables

- [IAMQQ] Contextual empty states: illustration + message + CTA. Different for no-data / no-match / no-permission
- [IMUXO] Skeleton rows matching columns. Count = pagination `first`. After 3s → "Taking longer..." + retry
- [INREX] Total count + window ("51–100 of 243"). Rows-per-page selector. Persist via nuqs. Fetch `totalCount`
- [IXABI] Design for 1366×768. Default 5–7 cols. Visibility toggle. Sticky first+last on scroll
- [JABGL] Top 1–2 actions inline. Rest in grouped overflow. Destructive = bottom, red. Bulk → floating bar
- [JQGQM] Prefix match minimum. 300ms debounce. Multi-field search. Bilingual. Show match context
- [JSUFS] ALL filters in URL via nuqs. Removable chips. "Copy filter link". "Clear All"
- [JXIUA] Sort arrows on active column. Meaningful defaults per entity. Shift+click multi-sort
- [KQREY] Export CSV/Excel on every table. Respects filters/sort. >5000 rows → async Temporal + notification
- [LAAEL] `@media print`: hide chrome, expand columns, institute header/footer. Dedicated receipt/ID/TC templates

## Navigation

- [LEYPF] Sidebar: grouped + collapsible (Academics, People, Finance, Admin). Role-filtered. Pinnable favorites
- [LODGO] Breadcrumbs everywhere, every segment clickable. Mobile: `← Parent / Current`
- [MENVQ] ⌘K command palette: entities, quick actions, navigation. Debounced async search
- [MXJLE] Institute switch preserves route. Header shows institute name+logo. Impersonation = amber banner

## States

- [MYORD] Skeleton page layouts. Shell renders instantly. Apollo stale-while-revalidate over spinner wipes
- [NGIAC] Every mutation: idle → loading (spinner) → success toast | error toast + retry. Map GraphQL errors to human text
- [NTLOD] Toggles: optimistic via Apollo `optimisticResponse`. Revert + toast on rejection
- [OJAAC] Offline banner. Auto-save drafts (see HUPGP). Connection indicator (green/yellow/red). Refetch on reconnect
- [OPULR] Each section in own `react-error-boundary`. Fallback: "Failed to load" + Retry. Log to Sentry
- [OYTMH] Session warning 5min before expiry. Preserve URL + form state on expiry. Redirect back after re-login

## Feedback

- [PAODR] Success toast: 3–4s. Error: persist. Action: Undo (5s). Stack vertically (Sonner)
- [PLNIH] Destructive: soft-delete → undo toast. Significant → consequence dialog. Catastrophic → type-to-confirm
- [PRMVO] >3s operations: progress with stages. Stream Temporal via subscription. Navigate-away safe
- [PTUCK] Wizard completion: summary screen + next-step action cards

## Responsive

- [PVTXG] Primary: 1366×768. Test: 1366/1280/768/360. Sidebar collapses <1280. PWA for mobile
- [QDPGR] Touch: 44×44px minimum. Mobile table rows tappable. Swipe for attendance
- [QIGCL] Desktop = Dialog, Mobile = Sheet. Scrollable + sticky footer. Swipe-to-close

## Multi-Tenancy

- [QJRQQ] Institute name+logo in header. Color accent per institute. Impersonation = amber banner
- [QPAGS] Never client-side filter for tenant isolation — RLS only. Dev: tenant ID overlay. E2E: cross-tenant tests
- [QQRVH] Usage vs limits ("498/500"). Warning >90%. At limit: disable Add + upgrade. Specific error codes

## Accessibility & i18n

- [QUVSN] Logical tab order. Escape closes modals. `focus-visible:ring`. Arrow keys in custom grids
- [ROGXK] Logical CSS only: `ms-4`/`me-4` not `ml-4`/`mr-4`. Periodic RTL test. Icons flip
- [RVSBJ] Color + icon/shape always. Badges = color + text. Charts = patterns + colors
- [SZWFX] `t()` on every string day 1. ICU placeholders. Hindi = 30–40% longer. Per-namespace JSONs
- [TRPFC] Toasts: `aria-live`. Loading: `aria-busy`. Tables: proper semantics. Modals: focus trap. Icons: `aria-label`

## Dashboards

- [TYJNS] Time-relative metrics only. Trends. Action items with links. No vanity numbers
- [UJQOC] Role-specific: teacher/principal/accountant/super-admin get different widgets
- [UQPCL] Charts: always comparison + annotations. Negative trends → action suggestion

## Attendance

- [VTLRR] Grid: default Present, tap absentees. "Mark All Present". Photos. Swipe on mobile. Summary bar
- [WINBA] States: Present/Absent/Late/Half-Day/Leave. Late = auto-timestamp. Summary counts
- [WODEL] Editable same-day. After → admin approval (audited). Confirmation screen. 30s undo

## Fees

- [WRNVG] Summary card at top. Breakdown with descriptions. Schedule. RTE = ₹0 clearly shown
- [XJLWH] Ledger: date/description/debit/credit/balance. Receipt PDF. Overdue = red. Parent portal access
- [YPQTF] Indian-format on blur. >₹10K → confirmation. Bulk → summary before submit. No negatives

## Real-Time

- [ZAQWT] Subscriptions push changes. Changed rows flash (200ms). Concurrent edit warning. "Last updated"
- [ZBKYJ] graphql-ws exponential backoff. Banner on disconnect. Refetch on reconnect. Manual button after 3 fails

## Onboarding

- [ZCNPW] Setup checklist on dashboard (6 steps). Links to pages. Progress bar. Dismissible after completion
- [ZDQKA] Field ⓘ help from help topics (see DNMPQ), "Read more" articles over the form for complex fields. "How this works" collapsible. Video links. No guided tours

## Performance

- [ZFVZD] Skeletons > spinners. 150ms page transitions. Prefetch next pages. Cache tab data
- [ZGQBR] Dynamic import heavy components. Lazy-load Recharts/cmdk. Budget: main <200KB gzip. `next build --analyze`
- [ZHXDF] Next.js `<Image>`. Logo thumbnails on upload. Grid photos 48×48. Blur placeholders. lucide-react icons

## Security

- [ZJRNK] Active sessions list. "Sign out all others". New device notification. Encourage passkey
- [ZKFQP] Copy = "Copied!" toast. Sensitive = masked `XXXX-1234` + Reveal (auto-hide 10s). Log to audit

## Notifications

- [ZLVWT] Bell + unread badge. Grouped panel. Click → relevant page. "Mark all read"
- [ZMNHR] No push prompt on first visit. In-app banner first → browser prompt on "Enable". Re-prompt after 7d

## Drag & Drop

- [ZNUKW] Timetable: drag cards to slots. Conflict highlighting. Undo/redo. Auto-save. Form fallback for a11y
- [ZOMPK] Student assignment: dual-list transfer. Bulk select. Count + capacity. 30s undo toast
