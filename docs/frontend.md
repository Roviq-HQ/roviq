# Frontend

## Date contract

- **Wire format**: ISO 8601 only — `YYYY-MM-DD` for dates, RFC 3339 / `YYYY-MM-DDTHH:mm:ssZ` for timestamps. Never pass display-formatted strings (`DD/MM/YYYY`, `MM/DD/YYYY`) across any boundary (form→hook, hook→API, API response).
- **Display**: Always use `useFormatDate()` from `@roviq/i18n`. Never call `date.toLocaleDateString()`, `date.toLocaleTimeString()`, or bare `format()` from `date-fns` directly in components.
- **Parsing**: Use `parseISO()` from `date-fns` when converting an ISO string to a `Date` object. Never `new Date('10/12/2022')` (ambiguous locale), never `Date.parse()`.
- **DD/MM vs MM/DD footgun**: Dates in India are DD/MM/YYYY but ISO is YYYY-MM-DD. A display string must **never** be re-parsed. Store and transmit ISO; display-only at the final render step.
- **Forms**: Every date-accepting input must be backed by a date picker (not free text). The picker's `onChange` emits ISO `YYYY-MM-DD`. Zod schemas validate with `.regex(/^\d{4}-\d{2}-\d{2}$/)` or `emptyStringToUndefined(z.string().regex(...).optional())` for optional fields.
- **Timezone**: Server-side calendar logic (attendance, reports) uses `getInstituteToday(institute)` / `getInstituteNow(institute)` from `apps/api-gateway/src/common/timezone` (API-gateway-internal). Never use bare `new Date()` for calendar-day decisions.

## Apps

> Ports and URLs here are the instance 0 (main checkout) values. In a parallel dev instance each is shifted by `slot × 20`; run `pnpm instance:ports` to see yours. See `docs/infrastructure.md` → "Parallel dev instances".

| App | URL | Purpose |
|-----|-----|---------|
| admin-portal | http://localhost:4200 | Platform admin — manage institutes, users, system health |
| institute-portal | http://localhost:4300 | Institute-facing — attendance, timetables, students |

Both apps share UI components from `@roviq/ui`, auth logic from `@roviq/auth`, and i18n from `@roviq/i18n`.

## Error messages

Never show `error.message` from the API and never match on its text. Branch on the error code and show translated copy:

- **Apollo operations** — `extractGraphQLErrorCode(error)` from `@roviq/graphql`, then `t(code)`; `extractGraphQLError(error, fallback)` only for developer-facing detail.
- **Auth flows** (`@roviq/auth` uses its own fetch client) — errors are `AuthRequestError` with a `code`. `isAppError(error, 'SESSION_EXPIRED')` to branch, `resolveAuthErrorMessage(error, labels)` for copy. It also classifies browser failures: `network`, `passkeyCancelled`, `passkeyAlreadyRegistered`, `passkeyNotSupported`.
- **Labels** — `useAuthErrorLabels()` (`@web/hooks/use-auth-error-labels`) returns every `auth.errors.*` message; pass it as `labels.errors` to `LoginForm`, `PasskeyManager`, `PasswordChangeForm` and the session-expired dialog. A new auth code needs an entry in `AUTH_ERROR_CODES` (`libs/frontend/auth/src/lib/error-utils.ts`) and in both `auth.json` files.
- **Where it shows** — errors the user must act on render inline (`role="alert"`). Transient ones are toasts: a dropped connection gets a Retry action, a dismissed passkey prompt is an info toast, not an error.

## Common components

App-wide reusable components live in `apps/web/src/components/` (import via the `@web/components/*` alias) — prefer these over re-building per feature. Data-coupled ones fetch via `@roviq/graphql` (inline `gql`/`useQuery`) or reuse existing feature hooks through the `@web/*` alias; they must NOT live in `@roviq/ui` (a lib cannot import app code). **Add one concise line here per new common component.**

- `pickers/SectionPicker` — multi-select of class sections grouped by department → standard, with per-class / per-department / global "select all" and a live count.
- `pickers/StandardSectionSelect` — cascading single Standard → Section dropdown selector.
- `pickers/AcademicYearSelector` + `useSelectedAcademicYear()` — persistent academic-year dropdown stored in the URL via nuqs (`?year=`); seeds the active year on load and exposes `loading`. Shared across academic-years, academics, and examinations pages. `ControlledAcademicYearSelector` + `useLocalAcademicYear()` is the same dropdown with caller-held state (no URL) — used only inside the timetable creation wizard; every other timetable read resolves the active year server-side.

- `account/LanguagePreference` — shared account language setting for all three portals; saved preferences apply after authentication, with browser language then English as fallback. The topbar selector remains a per-visit override.
- `AccountLocaleSync` — applies the authenticated account language once per account load, preserving the route, query and fragment.
- `people/DeletedRecordsButton` + `people/DeletePersonButton` — delete, Deleted list and Restore for students, staff and guardians (`kind` prop). Delete states the consequence and offers Undo on the toast; both are gated by `<Can>` (`delete` / `restore`).
- `audit/AuditLogFilters` + `audit/AuditLogTable` — the audit log list used by all three portals: URL-backed filters (multi-select action type, entity ID search, date range, optional institute dropdown), expandable rows showing the old → new diff, entity IDs linked to their detail page (`auditEntityHref` in `audit/audit-utils.ts` holds the entity type → route map), and the detail sheet. A portal page only picks its columns and passes its query result. `useAuditLabels()` supplies the translated `labels` for `AuditDiffRenderer` / `ImpersonationBadge`.

## Shared Libraries

### @roviq/ui
shadcn/ui components + layout shell. Key exports:
- All shadcn primitives (Button, Input, Card, Dialog, Select, etc.)
- `AdminLayout` — sidebar + topbar + command palette shell (accepts `LayoutConfig`)
- `OrgSwitcher` — dropdown in topbar for switching between institutes (visible when user has >1 membership)
- `AbilityProvider`, `Can`, `useAbility` — CASL React integration
- `RouteGuard` — page-level permission check with 403 fallback
- `DataTable` — pass `expansion={{ render, canExpand?, labels }}` for expandable rows (a leading toggle column; the expanded content spans the full width). Pass `getRowId` with it whenever rows can change.
- `MultiSelect` — popover checkbox list for multi-value filters; pair with nuqs `parseAsArrayOf(parseAsString)`.

### @roviq/auth
Client-side auth state management:
- `AuthProvider` / `useAuth()` — login, logout, refresh, selectInstitute, switchInstitute
- `ProtectedRoute` — redirects unauthenticated users to login, or to `/select-institute` when institute selection pending
- `LoginForm` / `ReAuthForm` / `PasswordChangeForm` / `PasskeyManager` — built on the `@roviq/ui` form kit (`useAppForm` + `@tanstack/react-form`) with Zod validation. See [forms.md](forms.md) for the kit API.
- `tokenStorage` — sessionStorage (access token, platform token) + localStorage (refresh token, user, memberships)
- `needsInstituteSelection` / `memberships` — state for multi-institute picker flow

### @roviq/graphql
Apollo Client setup:
- HTTP + WebSocket split link
- Auth link (injects Bearer token)
- Error link (handles 401 → auth refresh, network errors)
- Cache normalization for core entities

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
- `InstituteLocalesProvider` / `useInstituteLocales()` — institute content languages, separate from interface locales; `I18nField` renders enabled languages and `useI18nField()` falls back through the institute default. Required text needs English plus that default. See [content language configuration](plans/per-tenant-locale-config.md).
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
  orgSwitcher: {
    currentOrg: { tenantId, name, logoUrl },
    otherOrgs: [...],
    onSwitch: (tenantId) => switchInstitute(tenantId),
  },
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
| Phone   | `<sm`      | Drawer       | Hamburger + crumbs + bell + avatar | Visible (4 slugs + More) |
| Tablet  | `sm`–`xl`  | Drawer       | Hamburger + crumbs + bell + avatar | Visible        |
| Desktop | `xl+` (1280+) | Always-on | Crumbs + search + bell + avatar    | Hidden         |

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
