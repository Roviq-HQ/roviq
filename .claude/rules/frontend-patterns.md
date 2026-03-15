---
paths:
  - "apps/admin-portal/**"
  - "apps/institute-portal/**"
  - "libs/frontend/**"
---

# Frontend Code Patterns (Next.js / admin-portal & institute-portal)

## General

- `nuqs` (URL state) → TanStack Table → Apollo Client → shadcn/ui
- Use `<Can>` from `@casl/react` for conditional rendering
- Use `@roviq/ui` components — never raw HTML elements
- All user-facing text must use `useTranslations()` from `next-intl` — never hardcode strings

## i18n

- Both Next.js apps use `[locale]` route segments (`/en/dashboard`, `/hi/dashboard`)
- Translation files are per-namespace in `messages/{locale}/` (e.g., `common.json`, `dashboard.json`)
- New features → create a new namespace JSON file and import it in `src/i18n/request.ts`
- Use `useFormatDate()` / `useFormatNumber()` from `@roviq/i18n` for locale-aware formatting
- Sidebar nav hrefs are auto-prefixed with the current locale in `@roviq/ui`'s sidebar component

## Forms — Field Components (NOT legacy Form)

Use `Field`/`FieldLabel`/`FieldError`/`FieldGroup`/`FieldSet` for **all** forms. Never add the legacy `form.tsx` (`shadcn add form`) — it is superseded by Field.

```tsx
// With react-hook-form + Controller
<Controller
  name="email"
  control={form.control}
  render={({ field, fieldState }) => (
    <Field data-invalid={fieldState.invalid}>
      <FieldLabel htmlFor={field.name}>Email</FieldLabel>
      <Input {...field} id={field.name} aria-invalid={fieldState.invalid} />
      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
    </Field>
  )}
/>
```

**Key rules:**
- Wrap every input in `<Field>` — set `data-invalid` on Field, `aria-invalid` on the control
- Group related fields with `<FieldGroup>`, semantic sections with `<FieldSet>` + `<FieldLegend>`
- `<FieldError>` accepts `errors` array (react-hook-form, TanStack Form, Standard Schema / Zod issues)
- Orientation: `vertical` (default), `horizontal` (label beside control), `responsive` (auto via container query)
- For checkboxes/switches: nest `<Field>` inside `<FieldLabel>` for selectable field groups
- Add `<FieldDescription>` for helper text, `<FieldContent>` to group control + description in horizontal layouts

## Naming Conventions

- camelCase: variables, functions
- PascalCase: components, types
- kebab-case: file names
- `@roviq/*`: library imports

## Code Style

- TypeScript strict mode, target ES2022
- Exports at top, private methods at bottom
- >2 params → use object parameter
- Only export what's used externally
