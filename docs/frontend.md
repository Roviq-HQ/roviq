# Frontend

## Date contract

- **Wire format**: ISO 8601 only — `YYYY-MM-DD` for dates, RFC 3339 / `YYYY-MM-DDTHH:mm:ssZ` for timestamps. Never pass display-formatted strings (`DD/MM/YYYY`, `MM/DD/YYYY`) across any boundary (form→hook, hook→API, API response).
- **Display**: Always use `useFormatDate()` from `@roviq/i18n`. Never call `date.toLocaleDateString()`, `date.toLocaleTimeString()`, or bare `format()` from `date-fns` directly in components.
- **Parsing**: Use `parseISO()` from `date-fns` when converting an ISO string to a `Date` object. Never `new Date('10/12/2022')` (ambiguous locale), never `Date.parse()`.
- **DD/MM vs MM/DD footgun**: Dates in India are DD/MM/YYYY but ISO is YYYY-MM-DD. A display string must **never** be re-parsed. Store and transmit ISO; display-only at the final render step.
- **Forms**: Every date-accepting input must be backed by a date picker (not free text). The picker's `onChange` emits ISO `YYYY-MM-DD`. Zod schemas validate with `.regex(/^\d{4}-\d{2}-\d{2}$/)` or `emptyStringToUndefined(z.string().regex(...).optional())` for optional fields.
- **Timezone**: Server-side calendar logic (attendance, reports) uses `getInstituteToday(institute)` / `getInstituteNow(institute)` from `apps/api-gateway/src/common/timezone` (API-gateway-internal). Never use bare `new Date()` for calendar-day decisions.

## Portals

One Next.js app (`apps/web`) serves three portals. `middleware.ts` picks the portal from the host name.

> Ports and URLs here are the instance 0 (main checkout) values. In a parallel dev instance each is shifted by `slot × 20`; run `pnpm instance:ports` to see yours. See `docs/infrastructure.md` → "Parallel dev instances".

| Portal | Local URL | Code | For |
|--------|-----------|------|-----|
| Admin | http://admin.localhost:4200 | `app/[locale]/admin/` | Platform staff: institutes, resellers, system health |
| Reseller | http://reseller.localhost:4200 | `app/[locale]/reseller/` | Resellers: their institutes, billing, team |
| Institute | http://localhost:4200 | `app/[locale]/institute/` | Institute staff, students and guardians |

The portals share components from `@roviq/ui`, auth from `@roviq/auth` and i18n from `@roviq/i18n`.

## Error messages

Never show `error.message` from the API and never match on its text. Branch on the error code and show translated copy:

- **Apollo operations** — `useErrorCopy(namespace?)` (`@web/hooks/use-error-copy`) returns `errorCopy(err, fallback?)`: the copy for the error's `extensions.code` from the page's `errors` group, then the shared `error` namespace; `error.network` when the request never reached the server (`isNetworkError` from `@roviq/graphql`: a `ServerError`, a `ServerParseError`, or a `NetworkFetchError`, which the Apollo client's `fetch` wrapper raises for any failure of the request or of reading its body, whatever the browser's wording; a `TypeError` from the app's own code is not one); otherwise the translated fallback. Branch on `extractGraphQLErrorCode(error)` when a code needs its own handling (a field error, a dialog). `extractGraphQLError(error, fallback)` is developer-facing detail only.
- **Network failures** — the GraphQL client shows one translated toast (`error.networkTitle`, `error.network`) passed to `GraphQLProvider` as `networkErrorLabels`.
- **Crashes** — `PageErrorBoundary` shows the translated fallback (`AdminLayout` passes `error.*` labels), never the crash's own text.
- **Auth flows** (`@roviq/auth` uses its own fetch client) — errors are `AuthRequestError` with a `code`. `isAppError(error, 'SESSION_EXPIRED')` to branch, `resolveAuthErrorMessage(error, labels)` for copy. It also classifies browser failures: `network`, `passkeyCancelled`, `passkeyAlreadyRegistered`, `passkeyNotSupported`.
- **Labels** — `useAuthErrorLabels()` (`@web/hooks/use-auth-error-labels`) returns every `auth.errors.*` message; pass it as `labels.errors` to `LoginForm`, `PasskeyManager`, `PasswordChangeForm` and the session-expired dialog. A new auth code needs an entry in `AUTH_ERROR_CODES` (`libs/frontend/auth/src/lib/error-utils.ts`) and in both `auth.json` files.
- **Where it shows** — an error the user must act on stays on the screen, beside what it is about (`role="alert"`). A toast is gone before a slow reader finishes it and leaves nothing on the form to act on.

  | Failure | Where it shows |
  |---------|----------------|
  | A form submit failed because of one field (the server says a value is taken or invalid) | Under that field: `setServerFieldError`, and the form moves to the step or tab that holds the field. No toast as well |
  | A form submit failed as a whole (connection, permission, conflict, unknown) | An alert directly above the submit button that stays until the next attempt: `setFormSubmitError` + `<form.SubmitError />` |
  | An action inside a form that is not the submit (a preview, a lookup) failed | Beside the control that started it |
  | Success, undo, and an action with no form (delete a row, download a file, a toggle) | Toast. A dropped connection gets a Retry action; a dismissed passkey prompt is an info toast, not an error |

  **`pnpm check:form-errors`** (`scripts/check-form-errors.ts`, in the pre-push gate) fails on a `toast.error` inside the `onSubmit` or `onSubmitInvalid` of a `useAppForm` call. Forms written before the rule are listed with their counts in `scripts/form-errors-baseline.json`; a count may only go down, and a form is converted when it is next changed.

## Messages that report a problem

An alert, a banner, a failed or skipped status, an "unavailable" state: anything that tells a
person something is wrong must let someone who has never seen the code act on it. Check each one
against these six points before calling it done:

1. **What** happened, in the reader's words. An internal name (a rule, a code, an enum value) is
   never the only title; it may follow as small secondary text.
2. **Which one**: the channel, sender, institute, queue or record, by name.
3. **So what**: who is affected and whether it is happening now.
4. **Do this first**: one to three steps the reader can take from where they are.
5. **Go here**: a button or link to the screen, record or runbook section the step needs.
6. **When it ends**: how the reader knows it is over, and a state that looks different once it
   is (the Monitoring page shows a rule whose own query no longer passes as "Recovered").

The full procedure stays in its runbook (`docs/runbooks/`); the message carries the first steps
and links there. Example: the alert card on the admin Monitoring page
(`_components/alerts-panel.tsx`, copy in `adminMonitoring.alerts.rules`, screens in
`_lib/alert-guide.ts`; `scripts/__tests__/alert-copy.spec.ts` fails for a rule without copy).

## Hindi copy

Every Hindi string the app shows (message files, help topics, notification and email copy, error messages) is the Hindi people speak, not textbook Hindi. Most readers know Hindi but use English words for office and computer things.

- Keep the English word a clerk already uses, written in Devanagari: एडमिशन, सेशन, क्लास, सेक्शन, स्टूडेंट, एक्सपोर्ट, रिसीट, कोड, यूनिक, अप्रूव, रिजेक्ट, सर्टिफिकेट, ट्रांसफ़र, ऐक्टिव, सेव, डिलीट, लॉग इन.
- Write abbreviations, official names and enum-like values in Latin: TC, UDISE+, OBC, SC, ST, EWS, General, PDF, OTP.
- Keep simple Hindi for ordinary words (नया, बदलें, चुनें, खाली छोड़ें, पहली बार, वापस).
- Never use textbook words a reader would have to look up, such as पहचानकर्ता, अद्वितीय, अनुमोदन, रसीद, स्थानांतरण, प्रमाणपत्र, पार्श्व प्रवेश, प्रविष्टि, संशोधित.
- No emoji in copy; icons come from the components.
- A borrowed English verb takes its bare form before कर: मैनेज करें, रजिस्टर किया, never मैनेज्ड करें.
- One word for one concept, in every file. The words below are the ones the app uses; add a row when a new concept needs one.
- Registered templates (WhatsApp, DLT SMS) keep the text they were approved with; a new Hindi text needs a new template name (`…_v2`).

| Textbook word | Word to use |
|---------------|-------------|
| प्रवेश, प्रवेश संख्या | एडमिशन, एडमिशन नंबर |
| सत्र, शैक्षणिक वर्ष | सेशन, एकेडमिक ईयर |
| सत्रांश | टर्म |
| कक्षा, मानक | क्लास |
| अनुभाग | सेक्शन |
| विद्यार्थी, छात्र | स्टूडेंट |
| प्रमाणपत्र, जन्म प्रमाणपत्र | सर्टिफिकेट, बर्थ सर्टिफिकेट |
| स्थानांतरण प्रमाणपत्र | TC |
| स्थानांतरण, स्थानांतरित | ट्रांसफ़र |
| रसीद | रिसीट |
| शुल्क | फ़ीस |
| चालान | इनवॉइस |
| भुगतान | पेमेंट |
| उपस्थिति, अनुपस्थित | अटेंडेंस, ऐब्सेंट |
| कालांश, पाली | पीरियड, शिफ्ट |
| समय-सारणी | टाइमटेबल |
| कर्मचारी, शिक्षक | स्टाफ, टीचर |
| अनुरोध, आवेदन | रिक्वेस्ट, ऐप्लिकेशन |
| अनुमोदन, स्वीकृत, अस्वीकृत | अप्रूवल, अप्रूव, रिजेक्ट |
| समूह, सदस्य | ग्रुप, मेंबर |
| सदस्यता | सब्सक्रिप्शन (बिलिंग), मेंबरशिप (ग्रुप, रोल) |
| उपयोगकर्ता, खाता | यूज़र, अकाउंट |
| सूचना, संदेश | नोटिफ़िकेशन, मैसेज |
| नामांकन | एनरोलमेंट |
| पंजीकरण | रजिस्ट्रेशन |
| निर्यात, आयात | एक्सपोर्ट, इम्पोर्ट |
| सहेजें | सेव करें |
| सक्रिय, निष्क्रिय | ऐक्टिव, इनऐक्टिव |
| विफल, पुनः प्रयास | फ़ेल, दोबारा कोशिश |
| अद्वितीय, पहचानकर्ता, प्रविष्टि | यूनिक, आईडी, एंट्री |
| भूमिका | रोल |
| संग्रहित, संग्रहीत (archive) | आर्काइव |
| तिथि, प्रारंभ तिथि, समाप्ति तिथि | तारीख, शुरू की तारीख, आखिरी तारीख |
| पूर्ववत | वापस (वापस लें, वापस नहीं किया जा सकता) |
| प्रतिरूपण, प्रतिरूपित | इम्पर्सोनेशन, इम्पर्सोनेट किया |
| विद्यालय, पुस्तकालय (institute type) | स्कूल, लाइब्रेरी |
| वैकल्पिक, आवश्यक | ज़रूरी नहीं, ज़रूरी |
| केवल, उपयोग | सिर्फ़, इस्तेमाल |

## Field help

Three kinds of text can sit around a form field. Forms stay short because only the instruction is always on screen.

| Kind | Where | Shown |
|------|-------|-------|
| Instruction needed to fill the field: format, limit, a warning about a consequential choice, the error | `description` (or `<FieldDescription>`) and the error, **after** the input | Always |
| Optional hint: one sentence, only where seeing it inline saves time | the topic's `hint`, under the label | Form help mode `ICON_AND_HINT` only |
| Explanation: what the field is, why it is asked, what each choice changes | the topic's `body` in the ⓘ popover; an article for a field whose effects need more | On demand |

A simple field (name, mobile) gets a clear label and nothing else.

**Help topics** live in one module per form, `apps/web/src/help/<area>/<form>.help.ts`, made with `defineFieldHelp('<scope>', { <key>: { … } })` from `@roviq/ui`. A topic's id is `<scope>.<key>`. Every text is `{ en, hi }` (`HelpText`, typed by `Locale`, so a missing language does not build):

- `title` and `body` (≤ `HELP_LIMITS.body` characters); `hint` (≤ `HELP_LIMITS.hint`) and `example` are optional.
- `points` (short rules) and `avoid` (what not to enter, and why) are optional. A topic with `points` is shown in the **rich layout**: the first sentence of `body` in bold, the rest of it plain, the points as bullets, `options` as a two-column table (choice in bold, what it means), `example` in a green box with a check icon ("Example:", or "Good:" when the topic also has `avoid`), and `avoid` in an amber box with a warning icon. A topic without `points` keeps the plain layout.
- `options` says what each choice changes, keyed by the real option value; `helpOptions<Enum>({ … })` types the keys.
- `values` passes real shared constants, used as `{name}` in the copy, so a limit is never typed twice.
- `article: () => import('./<form>.articles').then((m) => m.<key>)` loads a longer article (headings, paragraphs, steps, warnings) only when "Read more" is opened; `HelpArticleSheet` shows it over the form, which stays mounted.

Two forms that describe the same behaviour import one topic.

**Writing help copy.** Readers are office clerks, principals and teachers, reading in a popover.

- **Shape**: `body` is one short lead sentence (what it is), then at most one more (where it is printed or used). Rules go in `points`, one fact each, at most four. Choices go in `options`, a few words each, so the table stays readable. Example values go in `example`; a common mistake goes in `avoid` with its consequence.
- **Hindi** follows "Hindi copy" below; option labels too, because the table shows them.
- No emoji in copy: the layout adds the icons.

**Using a topic**: pass it as `help={<formHelp>.<key>}` to a shared field (`TextField`, `SelectField`, …), or to `FieldLabelWithInfo` beside a raw `FieldLabel`. The field renders the ⓘ button (its accessible name includes the field label), the hint under the label, per-option help under each `SelectField` choice, and links hint, description and error to the input through `aria-describedby` (`useFieldHelpIds`).

**Form help mode**: `ICON_AND_HINT` (default) or `ICON_ONLY`, supplied by `FormHelpModeProvider` and read with `useFormHelpMode()`. Without a provider fields use the default.

**`pnpm check:field-help`** (`scripts/check-field-help.ts`, in the pre-push gate) fails on a topic with a missing or empty language, a hint or body over the limit, a duplicate id, an article file that does not exist, a topic no field uses, `defineFieldHelp` outside `apps/web/src/help/`, and any `FieldDescription` or muted `<p>` between a field's label and its input. The script's header states exactly what counts as an input.

**Keeping help true.** Each help file has a sibling `<form>.help.sources.ts` that forms never import. It lists, per topic, the code the topic describes, typed `satisfies HelpSources<typeof <formHelp>>` so every topic needs an entry: `path`, `path#Symbol` or `path#Symbol.member` (a class method, an object or schema property, a table column), covering the defaults, values, permissions, validations and effects the copy states, frontend and backend. `apps/web/src/help/field-help.lock.json` holds a fingerprint of every target per topic and the reason given at the last review. A TypeScript target's fingerprint ignores comments and formatting; another file's ignores whitespace. When a target changes, `pnpm check:field-help` fails and prints only that topic's English hint and body and the changed targets. Editing the copy does not clear it; after reading the topic and updating both languages if the behaviour changed, run `pnpm help:ack <topic> --reason "<what you checked>"`. `pnpm help:ack --new --reason "…"` records only topics that have no lock entry yet (a new help file); it never clears a changed topic. Changes the sources do not list are caught by the `update-docs` skill's field help row.

## Common components

App-wide reusable components live in `apps/web/src/components/` (import via the `@web/components/*` alias) — prefer these over re-building per feature. Data-coupled ones fetch via `@roviq/graphql` (inline `gql`/`useQuery`) or reuse existing feature hooks through the `@web/*` alias; they must NOT live in `@roviq/ui` (a lib cannot import app code). **Add one concise line here per new common component.**

- `hooks/useLocaleChange()` — topbar language switch handler wired into all three `(dashboard)/layout.tsx` (`LayoutConfig.onLocaleChange`): saves the account language, then navigates; navigates only when impersonating.
- `FieldHelpButton` + `FieldLabelWithInfo` (`@roviq/ui`) — the ⓘ button and popover for a help topic, and a label with that button beside it plus the topic's hint; use `FieldLabelWithInfo help={…}` for a raw `FieldLabel` (see "Field help").
- `setServerFieldError(form, field, message)` (`@roviq/ui`) — shows a server rejection under a form field; cleared when that field's value changes, and kept when the field is unmounted and mounted again (a wizard step, a tab). Pass the form or the `formApi` that `onSubmit` receives. Never hand-set `errorMap` with `setFieldMeta`: an `onChange` error sticks and refuses every submit.
- `setFormSubmitError(form, { title, description })` + `<form.SubmitError />` (`@roviq/ui`) — a failed submit that is not about one field: the alert sits directly above the submit button, scrolls into view, stays while the person edits, and clears when the next submit starts. It never disables the submit button. `clearFormSubmitError(form)` removes it early. Which error goes where: "Error messages" → "Where it shows".
- `pickers/SectionPicker` — multi-select of class sections grouped by department → standard, with per-class / per-department / global "select all" and a live count.
- `pickers/StandardSectionSelect` — cascading single Standard → Section dropdown selector.
- `pickers/AcademicYearSelector` + `useSelectedAcademicYear()` — persistent academic-year dropdown stored in the URL via nuqs (`?year=`); seeds the active year on load and exposes `loading`. Shared across academic-years, academics, and examinations pages. `ControlledAcademicYearSelector` + `useLocalAcademicYear()` is the same dropdown with caller-held state (no URL) — used only inside the timetable creation wizard; every other timetable read resolves the active year server-side.

- `file-upload/FileUpload` + `useFileUpload(purpose)` — the only way to upload a file: drag and drop or picker, checks type and size against `FILE_PURPOSE_POLICY` before uploading, shows progress with cancel and retry, and reports the finished `fileIds` through `onChange`, with the picked `File`s as the second argument for a page that reads the file in the browser (`onBusyChange` lets the form block submit meanwhile). Pass the ids to the mutation that owns the record. A purpose that takes CSV accepts a `.csv` by its name, since Windows reports it as `application/vnd.ms-excel`. `fileUploadErrorKey()` maps a file error code to a `fileUpload.errors` message.
- `stored-image/StoredImage` — shows an image from file storage (`FileRef` selected with `url(variant: SM | MD | FULL)`, `width`, `height`, `placeholder`): blurred preview first, fixed shape so the page does not jump, `fallback` when there is no image or it fails. Use it for every stored picture; never `next/image` on a signed link.
- `file-upload/FileUpload crop="square"` — opens a crop dialog (drag, pinch, zoom slider, arrow keys) before a profile picture is uploaded; the cropped picture is what gets sent. Every picked image is also scaled down in the browser first (`prepareImage`).
- `file-upload/FileDownloadButton` — opens a sensitive file (`FileRef` whose `url` is null): each click asks the server for a 60-second link (`scope="institute"`, `"admin"` for a user document, or `"adminExport"` for a compliance export), which is what writes the audit entry. Never render a stored `url` for these files
- `people/ProfilePhotoButton` — "Change picture" button and dialog for a student, staff member, guardian or the signed-in user (`kind`, `profileId`, `userId`): crop, upload, save or remove, then reloads the queries on screen. Wrap it in `<Can I="update" …>`
- `display-settings/DisplaySettingsProvider` + `useDisplaySettings()` — wraps each portal's dashboard layout: loads the account's form help mode (`myFormHelpMode`), passes it to `FormHelpModeProvider` from `@roviq/ui`, and hosts the Display settings dialog (`openDisplaySettings()`, a Quick action in every portal). A browser copy keyed by account id (`roviq:form-help-mode:<userId>`) shows the last confirmed value while loading; a failed load falls back to it or the default, a failed save keeps the last confirmed choice and offers Retry; while impersonating it is read-only and the copy is left alone. `DisplaySettingsDialog` (dialog on desktop, bottom sheet on phones) and `DisplaySettingsCard` (My Account) render the same `DisplaySettingsPanel`.
- `account/LanguagePreference` — shared account language setting for all three portals; saved preferences apply on sign-in, with browser language then English as fallback. The topbar selector remains a per-visit override.
- `AccountLocaleSync` — applies the account language on sign-in and on switching accounts, preserving the route, query and fragment. A session restored on page load keeps the locale in the URL, so a `/hi/...` link opens in Hindi whatever the saved language.
- `PersonNameLink` + `PersonDetailDialogProvider` (`app/[locale]/institute/(dashboard)/people/person-detail-dialog.tsx`) — a linked student/guardian name that opens that person's full detail view in a popup with Back history; use it wherever a related person's name is shown under People. Lives beside the routes because it renders the route views.
- `people/DeletedRecordsButton` + `people/DeletePersonButton` — delete, Deleted list and Restore for students, staff and guardians (`kind` prop). Delete states the consequence and offers Undo on the toast; both are gated by `<Can>` (`delete` / `restore`).
- `audit/AuditLogFilters` + `audit/AuditLogTable` — the audit log list used by all three portals: URL-backed filters (multi-select action type, entity ID search, date range, optional institute dropdown), expandable rows showing the old → new diff, entity IDs linked to their detail page (`auditEntityHref` in `audit/audit-utils.ts` holds the entity type → route map), and the detail sheet. A portal page only picks its columns and passes its query result. `useAuditLabels()` supplies the translated `labels` for `AuditDiffRenderer` / `ImpersonationBadge`.
- `institute/FirstAdminCard` — the first admin named on an institute (name, email, mobile) for the admin and reseller institute detail pages; labels and testid come in as props.
- `metrics/MetricCard` — titled stat tile (value, optional icon, hint line and a slot for a trend such as `Sparkline`); `—` for unknown values.
- `metrics/ServiceCard` — one dependency's health: status badge with icon + text (healthy / degraded / down, never colour alone), response time and uptime; labels come in as props.
- `metrics/StatusGrid` — responsive 1→6 column grid for `ServiceCard`s with a skeleton state (`loading`, `skeletonCount`, `aria-busy`).
- `metrics/Sparkline` — tiny Recharts line (loaded client-side only via `next/dynamic`) with an accessible `label`; renders `emptyText` (`—`) for null/empty data.
- `impersonation/ImpersonateUserDialog` — start an impersonation from any portal: reason (≥10 characters), the approval-code step when the server asks for it, then opens the institute portal on `/auth/impersonate`. The caller passes its scope's start and verify mutations. `impersonation/ViewAsButton` wraps it for intra-institute "View as" (shown only when `canImpersonateUser` says yes); `impersonation/AdminImpersonateButton` is the platform equivalent for one institute membership of one user, with the approval-code step and resend built in. `impersonation/useImpersonationSession()` holds the state of an impersonated tab (active, ended, view-only, `exit`); the institute layout calls it once and passes it to `impersonation/ImpersonationBannerView` (through `AdminLayout`'s `banner` prop, so the banner takes its own row) and to the user menu, where Log out becomes Exit.
- `impersonation/ImpersonationSessionsTable` — impersonation sessions with status (Active, Ended, Revoked, Expired) and a confirmed Terminate on active rows; used by the admin and reseller session pages. The page passes its testid group, the impersonator column label and `onTerminate` (omit it to hide the action).
- `live-updates/LiveUpdatesBanner` and `live-updates/LiveConnectionIndicator` (`apps/web/src/components/`) — state of the live-updates socket, read with `useLiveConnection()` from `@roviq/graphql`. Every portal puts the banner in `AdminLayout`'s `banner` row and the indicator in `LayoutConfig.connectionIndicator`. The banner shows only while live changes are not arriving (reconnecting, offline, session ended) and offers Reconnect after `MANUAL_RECONNECT_AFTER` failed attempts or once the session ended; the indicator is hidden on pages with no live data. After a reconnect the client refetches the queries on screen.
- `notifications/NotificationBell` — the topbar bell of all three portals (passed to `AdminLayout` as `LayoutConfig.notificationBell`): unread badge, the signed-in user's notifications for the current scope with paging and live arrivals (`notificationReceived`), mark one on open and mark all; opens only a `data.path` inside the current portal (`notificationPath`); no mark controls while impersonating. `usePushNotifications()` returns `unregisterPushToken`, which each layout calls before logout.
- `buildCsv(headers, rows)` + `downloadCsv(filename, csv)` (`@web/lib/csv`) — CSV export of what a table shows: every field quoted, UTF-8 with a BOM so Excel opens Hindi correctly. Pass translated headers and values, never ids.
- `useRoleName()` (`@web/hooks/use-role-name`) — display name for any role. System roles store their key as the name (`class_teacher`, matched by the server), so they get a translated label from the `roles` namespace; a role an institute named itself is shown as written. Use it wherever a role name is shown, never `useI18nField()` on a role name.
- `useErrorCopy(namespace?)` (`@web/hooks/use-error-copy`) — translated copy for a failed request (see "Error messages"); use it for every error toast or inline error, never `err.message`.
- `CopyIdButton` (`@web/components/copy-id-button`) — copies a full id where a list has no name to show (`value`, `name` for its "Copy …" label, `rowKey` for the row or place it sits in, which keeps its test id unique when an id repeats) and confirms with a "Copied!" toast; does not open the row it sits in. Show a name when one exists, never a shortened id.
- `usePersonName()` (`@web/hooks/use-person-name`) — full name in the current language from i18n first and last names; `''` when there is none, so the caller shows its own translated fallback ("Unknown student").

## Shared Libraries

### @roviq/ui
shadcn/ui components + layout shell. Key exports:
- All shadcn primitives (Button, Input, Card, Dialog, Select, etc.)
- `AdminLayout` — sidebar + topbar + command palette shell (accepts `LayoutConfig`)
- `InstituteSwitcher` — dropdown for switching between institutes; the topbar renders its own when `LayoutConfig.instituteSwitcher` is set
- `AbilityProvider`, `Can`, `useAbility` — CASL React integration
- `RouteGuard` — page-level permission check with 403 fallback
- `DataTable` — pass `expansion={{ render, canExpand?, labels }}` for expandable rows (a leading toggle column; the expanded content spans the full width). Pass `getRowId` with it whenever rows can change.
- `MultiSelect` — popover checkbox list for multi-value filters; pair with nuqs `parseAsArrayOf(parseAsString)`.

### @roviq/auth
Client-side auth state management:
- `AuthProvider` / `useAuth()` — login, logout, refresh, selectInstitute, switchInstitute
- `ProtectedRoute` — redirects unauthenticated users to login, or to `/select-institute` when institute selection pending
- `LoginForm` / `ReAuthForm` / `PasswordChangeForm` / `PasskeyManager` — built on the `@roviq/ui` form kit (`useAppForm` + `@tanstack/react-form`) with Zod validation. See [forms.md](guides/forms.md) for the kit API.
- `tokenStorage` — sessionStorage (access token, platform token) + localStorage (refresh token, user, memberships)
- `needsInstituteSelection` / `memberships` — state for multi-institute picker flow

### @roviq/graphql
Apollo Client setup:
- HTTP + WebSocket split link
- Auth link (injects Bearer token)
- Error link: a 401 refreshes the session and retries. A query or subscription (any operation but a mutation) that cannot reach the server shows one translated toast (`error.networkTitle`, `error.network`, passed to `GraphQLProvider` as `networkErrorLabels`). A mutation that cannot reach the server shows nothing here: its caller reports the failure, in the form or in its own toast (`isNetworkError(error)` tells a lost connection from another failure)
- Cache normalization for core entities
- Load-more pagination: every paginated query field needs a merge policy in `client.ts`, or `fetchMore` replaces page 1 instead of appending. Top-level `first`/`after` args use `relayStylePagination([...])`; connections that take the cursor inside `filter` (`adminListUsers`, `adminListResellers`, `adminListInstitutes`) use `filterCursorPagination()`

### @roviq/i18n
Internationalization powered by next-intl and date-fns:
- `locales`, `defaultLocale`, `localeLabels` — locale configuration (currently `en`, `hi`)
- `routing` — next-intl routing definition with `localePrefix: 'always'`
- `Link`, `redirect`, `usePathname`, `useRouter` — locale-aware navigation helpers
- `intlMiddleware` — pre-configured middleware for locale detection and redirects
- `createRequestConfig(loadMessages)` — factory for app-specific message loading with English fallback
- `useFormatDate()` — date formatting via date-fns with locale-aware output
- `useFormatNumber()` — number/currency/percent formatting via `Intl.NumberFormat`
- `LocaleSwitcher` — language dropdown component (in `@roviq/ui`)
- `InstituteLocalesProvider` / `useInstituteLocales()` — institute content languages, separate from interface locales; `I18nField` renders enabled languages and `useI18nField()` falls back through the institute default. Required text needs English plus that default.
- RTL-ready: `rtlLocales` config array, `dir` attribute on `<html>`

**Translation file structure** (per app):
```
apps/<app>/messages/
├── en/
│   ├── common.json    # Shared labels (appName, save, cancel, etc.)
│   ├── nav.json       # Sidebar navigation labels
│   ├── auth.json      # Login/logout, user menu
│   ├── dashboard.json # Dashboard page content
│   ├── selectOrg.json # Institute picker page
│   └── locale.json    # Language names (for switcher)
└── hi/
    └── ... (same structure)
```

**Locale routing**: All routes use `[locale]` segment — e.g. `/en/dashboard`, `/hi/dashboard`. The middleware auto-detects browser locale and redirects `/` to `/<defaultLocale>/`.

## Auth Flow (Frontend)

1. User visits `/login` — sees username + password fields (no institute ID)
2. **Single institute:** auto-redirected to `/dashboard`
3. **Multi institute:** redirected to `/select-institute` — picks an institute → `/dashboard`
4. **Institute switching:** topbar dropdown calls `switchInstitute()` — swaps tokens without re-login

## Styling

- Tailwind CSS v4 with CSS-native `@theme` configuration (no `tailwind.config.js`)
- CSS custom properties for colors (HSL) — ready for tenant theming
- `tw-animate-css` for animations
- `geist` font (sans + mono)

## Layout

The admin layout is configured per-app via `LayoutConfig`:

```tsx
const config: LayoutConfig = {
  appName: 'Roviq Admin',
  navGroups: [
    {
      title: 'Overview',
      items: [
        { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
        { title: 'Institutes', href: '/institutes', icon: Building2 },
      ],
    },
  ],
  instituteSwitcher: {
    currentTenantId,
    currentInstituteName,
    memberships: [{ tenantId, instituteName, instituteLogoUrl, roleName }],
    onSwitch: (tenantId) => switchInstitute(tenantId),
  },
  quickActions: [
    { id: 'display-settings', title: t('displaySettings'), icon: SlidersHorizontal, onSelect: openDisplaySettings },
    { id: 'add-student', title: t('addStudent'), href: '/people/students/new',
      ability: { action: 'create', subject: 'Student' } },
  ],
};

export default function Layout({ children }) {
  return <AdminLayout config={config}>{children}</AdminLayout>;
}
```

## Responsive layout + bottom tab bar

The shell adapts to three viewport classes — see [PVTXG] in `CLAUDE.md` for the
exact thresholds. Sidebar is always-on at desktop; below `xl` the same nav lives
in a drawer triggered from the topbar hamburger and a phone-only bottom tab bar
exposes 4 primary destinations.

| Class   | Width      | Sidebar      | Topbar          | Bottom tab bar |
| ------- | ---------- | ------------ | --------------- | -------------- |
| Phone   | `<sm`      | Drawer       | Hamburger + crumbs + Quick actions + bell + avatar | Visible (4 slugs + More) |
| Tablet  | `sm`–`xl`  | Drawer       | Hamburger + crumbs + Quick actions + bell + avatar | Visible        |
| Desktop | `xl+` (1280+) | Always-on | Crumbs + Quick actions + bell + avatar | Hidden         |

### LayoutConfig extension

`LayoutConfig` (in `libs/frontend/ui/src/components/layout/types.ts`) gained
`navRegistry`, `bottomNav`, `searchEnabled`, and `onSearch`. Each portal owns
its own registry mapping symbolic slugs (from `@roviq/common-types` →
`NAV_SLUGS`) to the rendered `{ href, icon, label, ability? }`:

```ts
const config: LayoutConfig = {
  // ...existing fields
  navRegistry: {
    dashboard: { href: '/dashboard', icon: LayoutDashboard, label: t('dashboard') },
    students:  { href: '/students',  icon: Users,           label: t('students'),
                 ability: { action: 'read', subject: 'Student' } },
    // ...
  },
  bottomNav: {
    slugs: user?.primaryNavSlugs ?? [],
    defaultSlugs: ['dashboard', 'students', 'enquiries', 'academics'],
    moreLabel: t('more'),
  },
  searchEnabled: true,
};
```

### CASL gating

Each `NavRegistryEntry` may declare an `ability: { action, subject }`. When the
bottom tab bar resolves slugs, it silently drops any whose ability the current
user lacks. The same registry is reused by the drawer, so customization that
includes a slug a viewer cannot use never produces a broken link or empty tab —
it just renders fewer items. Custom roles with no curated `slugs` fall through
to the per-portal `defaultSlugs`.

Sidebar items (`NavItem` in `navGroups`) take the same optional `ability`.
`AdminLayout` drops items the viewer cannot use — and any group left empty —
before the sidebar, drawer and command palette render, so a gated page never
shows a link that leads to a forbidden screen.

### Quick actions

The top-bar **Quick actions** button (and Ctrl/⌘+K) opens the command palette. Its first group is
`LayoutConfig.quickActions`: a page (`href`) or an action the app handles (`onSelect`), each with an
optional `ability`, filtered with the nav items. The user's pinned pages follow, then every nav
group; a pinned page that a quick action already opens is not listed twice. The institute portal
lists Display settings, Take attendance, Today's timetable, Add student and Add staff; the admin
and reseller portals list Display settings.

### Space under the last control

Below the `xl` breakpoint the bar floats over the page. `AdminLayout` gives `<main>`
`pb-24` there, so a page's last control (usually a Save button) comes to rest above
the bar instead of under it. Pages must not add their own bottom spacer for this.

### Active-tab / sidebar highlighting

Highlighting uses **longest-prefix match** against `pathname` (after stripping
the locale prefix), not exact equality. This is required because nested routes
like `/settings/consent` would otherwise highlight both `/settings` and
`/settings/consent` simultaneously — with longest-prefix only the consent entry
wins. The same logic drives both the desktop sidebar item and the bottom tab
bar's active state.

### Drawer auto-close on navigation

The drawer subscribes to pathname changes and closes itself on every transition.
Without this, navigating from the in-drawer "Search" entry → CommandPalette →
target page leaves the drawer mounted over the new content. Same applies to
clicking any drawer link directly.

### Per-portal `defaultSlugs`

Used when a role has no curated `primaryNavSlugs` (or the resolved list is
empty after CASL filtering):

| Portal    | defaultSlugs                                       |
| --------- | -------------------------------------------------- |
| Institute | `dashboard`, `students`, `enquiries`, `academics`  |
| Reseller  | `dashboard`, `institutes`, `team`, `billing`       |
| Admin     | `dashboard`, `resellers`, `institutes`, `audit`    |

### Tenant-admin customization

Institute admins customize per-role primary nav at **`/settings/roles`** in the
institute portal (v1 — reseller and admin portals have no UI yet). The page
calls `instituteRoles` to list roles and `updateRolePrimaryNav` to persist a
new slug list (max 4, validated server-side against `NAV_SLUGS`). See the
GraphQL surface notes in [architecture.md](architecture.md#per-role-primary-nav).
