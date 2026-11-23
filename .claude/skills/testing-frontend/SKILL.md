---
name: testing-frontend
description: Use when writing, modifying, or reviewing frontend tests — Vitest component tests (*.spec.tsx) with renderWithProviders, Apollo mocks and abilities, and Playwright UI tests (*.e2e.spec.ts) for the three portals
---

# Frontend tests

Two layers. Shared conventions and commands: `testing-unit` skill.

| Layer | Tool | Files | Proves |
|---|---|---|---|
| Component | Vitest (`unit-dom`) + React Testing Library | `__tests__/*.spec.tsx` beside the component | Conditional rendering, permission-gated UI, form validation, the copy shown for an error code |
| E2E UI | Playwright | `e2e/web-{admin,institute,reseller}-e2e/src/*.e2e.spec.ts` | A user journey in a browser against the e2e stack |

A component test does not replace driving the change in the browser (`docs/working-method.md` → "Browser pass"). It keeps the behavior from regressing afterwards.

## Component tests

Render through the shared helper, which supplies the real message bundle, an ability and Apollo mocks:

```tsx
import { renderWithProviders } from '<relative>/__test-utils__/render-with-providers';

renderWithProviders(<RemoveFromYearDialog open onOpenChange={onOpenChange} … />, {
  apolloMocks: [{ request: { query: RemoveDocument, variables }, result: { data } }],
  abilityRules: [{ action: 'read', subject: 'Student' }],   // default: everything allowed
  locale: 'en',
});
```

Working example: `apps/web/src/app/[locale]/institute/(dashboard)/people/students/__tests__/placement-dialogs.spec.tsx`.

- **Find elements** by role and name first, then by label, then by `testIds` from `@roviq/ui/testing/testid-registry` (`screen.getByTestId(testIds.group.key)`). Never a typed-in testid string, `container.querySelector` or a CSS selector.
- **Interact** with `userEvent`, and wait with `findBy…` or `waitFor`. No sleeps.
- **Always cover**: the element hidden without the ability and shown with it; the disabled and enabled states of a submit button; the validation message for bad input; the translated copy for each `extensions.code` the operation can return (the mock returns a GraphQL error with that code); the success path (toast, dialog closed, callback called).
- **Do not test**: Tailwind classes, static copy, a wrapper with no logic, the internals of shadcn, Radix or TanStack Table.
- A real message key missing in `en` or `hi` fails the test through the real bundle. Add the key to both files; do not pass fake `messages` to hide it.
- Storage and location are stubbed with `vi.stubGlobal`, not touched directly.

## Playwright UI tests

- Import `test` and `expect` from `e2e/shared/console-guardian`, not from `@playwright/test`: every test then fails on a console error, a GraphQL response with `errors`, a missing translation or a critical accessibility violation.
- Login happens once per project in `src/auth.setup.ts`, which saves `storageState`; specs never log in inline. Credentials, names and ids come from `e2e/shared/seed-fixtures.ts` (`E2E_USERS`, `SEED`).
- Page objects live in `src/pages/` of the project and `e2e/shared/pages/`; a spec holds no selectors of its own. Locators use `page.getByTestId(testIds.…)` or role and name.
- The three projects share one Next.js app on the e2e web port (slot 0: 4201): `localhost`, `admin.localhost`, `reseller.localhost`. Read the port from `E2E_WEB_PORT`; never type it. Run with `pnpm test:e2e:ui`.
- No `page.waitForTimeout`, no `window.location`, no hardcoded seed names. `toHaveScreenshot()` is allowed for visual regression.
- Create the data a journey needs through the UI or the API helper in `e2e/shared/api-client.ts`; do not depend on rows another spec left behind.
- **Until the product launches**, a Playwright test that fails only because the UI changed shape (moved control, renamed label) is skipped with a reason and the issue number, not repaired. A failure that shows a real defect is fixed. New work is covered by component tests, the API e2e suite and the browser pass; add a Playwright spec only when the issue asks for one.
