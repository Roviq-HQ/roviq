# Auth UI Wiring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire the existing `@roviq/auth` components (LoginForm, AuthProvider, ProtectedRoute, TenantPicker) into both portals, add a session-expired re-auth dialog, and make the topbar logout functional.

**Architecture:** Login pages at `[locale]/login/page.tsx` use `LoginForm`. `AuthProvider` + `GraphQLProvider` wrap both apps at the `[locale]/layout.tsx` level. Dashboard layouts are gated by `ProtectedRoute`. Session expiry shows an inline re-auth dialog (no redirect) so users resume seamlessly. Auth mutations use raw `fetch` to avoid circular dependency with Apollo.

**Tech Stack:** Next.js 16 App Router, @roviq/auth, @roviq/graphql, @roviq/ui (Dialog, Card), react-hook-form + Zod, next-intl, sonner

---

## Task 1: Auth GraphQL helpers (raw fetch mutations)

**Files:**
- Create: `libs/auth/src/lib/auth-mutations.ts`

The `AuthProvider` takes mutation callbacks. These use raw `fetch` to the GraphQL endpoint so they work without Apollo (which itself needs the auth token).

**Step 1: Create the auth mutation helpers**

```typescript
// libs/auth/src/lib/auth-mutations.ts
import type { AuthUser, LoginInput } from './types';

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

async function graphqlFetch<T>(url: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();

  if (json.errors?.length) {
    throw new Error(json.errors[0].message ?? 'GraphQL error');
  }

  return json.data;
}

export function createAuthMutations(graphqlUrl: string) {
  return {
    async login(input: LoginInput): Promise<AuthResponse> {
      const data = await graphqlFetch<{ login: AuthResponse }>(
        graphqlUrl,
        `mutation Login($username: String!, $password: String!, $tenantId: String!) {
          login(username: $username, password: $password, tenantId: $tenantId) {
            accessToken
            refreshToken
            user { id username email tenantId roleId abilityRules }
          }
        }`,
        { username: input.username, password: input.password, tenantId: input.tenantId },
      );
      return data.login;
    },

    async refresh(refreshToken: string): Promise<AuthResponse> {
      const data = await graphqlFetch<{ refreshToken: AuthResponse }>(
        graphqlUrl,
        `mutation RefreshToken($token: String!) {
          refreshToken(token: $token) {
            accessToken
            refreshToken
            user { id username email tenantId roleId abilityRules }
          }
        }`,
        { token: refreshToken },
      );
      return data.refreshToken;
    },

    async logout(): Promise<void> {
      // Best-effort, don't throw on failure
      try {
        await graphqlFetch(
          graphqlUrl,
          `mutation Logout { logout }`,
        );
      } catch {
        // Ignore — tokens are cleared client-side regardless
      }
    },
  };
}
```

**Step 2: Export from barrel**

Add to `libs/auth/src/index.ts`:
```typescript
export { createAuthMutations } from './lib/auth-mutations';
```

---

## Task 2: SessionExpiredDialog component

**Files:**
- Create: `libs/auth/src/lib/session-expired-dialog.tsx`

Non-dismissable dialog that renders `LoginForm` inline. On successful login, the dialog closes and the page stays where it was.

**Step 1: Create the component**

```typescript
// libs/auth/src/lib/session-expired-dialog.tsx
'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@roviq/ui';
import { LoginForm } from './login-form';

interface SessionExpiredDialogProps {
  open: boolean;
  username?: string;
  onLoginSuccess: () => void;
}

export function SessionExpiredDialog({ open, username, onLoginSuccess }: SessionExpiredDialogProps) {
  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-md [&>button]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Session Expired</DialogTitle>
          <DialogDescription>
            Your session has expired. Please log in again to continue.
          </DialogDescription>
        </DialogHeader>
        <LoginForm onSuccess={onLoginSuccess} />
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Export from barrel**

Add to `libs/auth/src/index.ts`:
```typescript
export { SessionExpiredDialog } from './lib/session-expired-dialog';
```

---

## Task 3: Update AuthProvider to track session expiry and render dialog

**Files:**
- Modify: `libs/auth/src/lib/auth-context.tsx`

Add `sessionExpired` state. When `onAuthError` fires (token refresh fails or Apollo gets UNAUTHENTICATED), set `sessionExpired = true`. Render `SessionExpiredDialog` inside the provider. On re-login success, clear the flag.

**Step 1: Modify AuthProvider**

Changes to `libs/auth/src/lib/auth-context.tsx`:

1. Add to `AuthState` interface: `sessionExpired: boolean`
2. Initialize: `sessionExpired: false` in default state
3. In the refresh failure catch block (line ~86-94), set `sessionExpired: true` instead of clearing auth state entirely (keep user info for pre-fill)
4. Add `onSessionExpired` flag tracking
5. Render `<SessionExpiredDialog>` inside the provider, before `{children}`
6. On re-login success in dialog, clear `sessionExpired` flag

Key changes to `AuthProvider`:

```typescript
// Add state for session expiry
const [sessionExpired, setSessionExpired] = React.useState(false);

// In the refresh timer catch block (replaces existing catch):
} catch {
  setSessionExpired(true);
  onAuthError?.();
}

// In the mount effect refresh catch block (replaces existing catch):
.catch(() => {
  tokenStorage.clear();
  setState({
    user: null,
    tokens: null,
    isAuthenticated: false,
    isLoading: false,
  });
});

// Add handler for re-login from dialog
const handleReLoginSuccess = React.useCallback(() => {
  setSessionExpired(false);
}, []);

// Update context value to include sessionExpired
const value = React.useMemo<AuthContextValue>(
  () => ({
    ...state,
    sessionExpired,
    login,
    logout,
    refreshSession,
    getAccessToken,
    switchTenant,
  }),
  [state, sessionExpired, login, logout, refreshSession, getAccessToken, switchTenant],
);

// Render SessionExpiredDialog inside provider
return (
  <AuthContext.Provider value={value}>
    {children}
    <SessionExpiredDialog
      open={sessionExpired}
      username={state.user?.username}
      onLoginSuccess={handleReLoginSuccess}
    />
  </AuthContext.Provider>
);
```

Also update `AuthContextValue` interface to include `sessionExpired: boolean`.

---

## Task 4: Expand auth translations

**Files:**
- Modify: `apps/admin-portal/messages/en/auth.json`
- Modify: `apps/admin-portal/messages/hi/auth.json`
- Modify: `apps/institute-portal/messages/en/auth.json`
- Modify: `apps/institute-portal/messages/hi/auth.json`

**Step 1: Update English translations (both apps)**

```json
{
  "login": "Log in",
  "logout": "Log out",
  "profile": "Profile",
  "myAccount": "My Account",
  "signIn": "Sign in",
  "signingIn": "Signing in...",
  "username": "Roviq ID",
  "password": "Password",
  "organizationId": "Organization ID",
  "enterUsername": "Enter your Roviq ID",
  "enterPassword": "Enter your password",
  "enterOrganizationId": "Enter organization ID",
  "usernameRequired": "Roviq ID is required",
  "passwordRequired": "Password is required",
  "organizationRequired": "Organization is required",
  "loginFailed": "Login failed. Please try again.",
  "welcomeBack": "Welcome back",
  "loginDescription": "Sign in to your account to continue",
  "sessionExpired": "Session Expired",
  "sessionExpiredDescription": "Your session has expired. Please log in again to continue."
}
```

**Step 2: Update Hindi translations (both apps)**

```json
{
  "login": "लॉग इन",
  "logout": "लॉग आउट",
  "profile": "प्रोफ़ाइल",
  "myAccount": "मेरा खाता",
  "signIn": "साइन इन करें",
  "signingIn": "साइन इन हो रहा है...",
  "username": "रोविक आईडी",
  "password": "पासवर्ड",
  "organizationId": "संस्था आईडी",
  "enterUsername": "अपनी रोविक आईडी दर्ज करें",
  "enterPassword": "अपना पासवर्ड दर्ज करें",
  "enterOrganizationId": "संस्था आईडी दर्ज करें",
  "usernameRequired": "रोविक आईडी आवश्यक है",
  "passwordRequired": "पासवर्ड आवश्यक है",
  "organizationRequired": "संस्था आवश्यक है",
  "loginFailed": "लॉगिन विफल। कृपया पुनः प्रयास करें।",
  "welcomeBack": "वापसी पर स्वागत",
  "loginDescription": "जारी रखने के लिए अपने खाते में साइन इन करें",
  "sessionExpired": "सत्र समाप्त",
  "sessionExpiredDescription": "आपका सत्र समाप्त हो गया है। कृपया जारी रखने के लिए पुनः लॉग इन करें।"
}
```

---

## Task 5: Update LoginForm to use translations

**Files:**
- Modify: `libs/auth/src/lib/login-form.tsx`

Currently labels are hardcoded English strings. Update to accept translations as props (since `@roviq/auth` doesn't have access to `next-intl` context directly, pass translated strings as props).

**Step 1: Add labels prop to LoginForm**

```typescript
// Add to LoginFormProps interface:
interface LoginFormProps {
  tenantId?: string;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  labels?: {
    username?: string;
    password?: string;
    organizationId?: string;
    enterUsername?: string;
    enterPassword?: string;
    enterOrganizationId?: string;
    signIn?: string;
    signingIn?: string;
  };
}

// Use labels with defaults in the component:
const l = {
  username: labels?.username ?? 'Username',
  password: labels?.password ?? 'Password',
  organizationId: labels?.organizationId ?? 'Organization ID',
  enterUsername: labels?.enterUsername ?? 'Enter your username',
  enterPassword: labels?.enterPassword ?? 'Enter your password',
  enterOrganizationId: labels?.enterOrganizationId ?? 'Enter organization ID',
  signIn: labels?.signIn ?? 'Sign in',
  signingIn: labels?.signingIn ?? 'Signing in...',
};

// Replace hardcoded strings in JSX:
// <Label htmlFor="tenantId">Organization ID</Label>  →  <Label htmlFor="tenantId">{l.organizationId}</Label>
// placeholder="Enter organization ID"  →  placeholder={l.enterOrganizationId}
// <Label htmlFor="username">Username</Label>  →  <Label htmlFor="username">{l.username}</Label>
// etc.
// Button text: {isSubmitting ? l.signingIn : l.signIn}
```

---

## Task 6: Update SessionExpiredDialog to use translations

**Files:**
- Modify: `libs/auth/src/lib/session-expired-dialog.tsx`

**Step 1: Add labels prop**

```typescript
interface SessionExpiredDialogProps {
  open: boolean;
  username?: string;
  onLoginSuccess: () => void;
  labels?: {
    title?: string;
    description?: string;
    formLabels?: LoginFormProps['labels'];
  };
}

// Use in component:
<DialogTitle>{labels?.title ?? 'Session Expired'}</DialogTitle>
<DialogDescription>
  {labels?.description ?? 'Your session has expired. Please log in again to continue.'}
</DialogDescription>
<LoginForm onSuccess={onLoginSuccess} labels={labels?.formLabels} />
```

---

## Task 7: Create login page for admin-portal

**Files:**
- Create: `apps/admin-portal/src/app/[locale]/login/page.tsx`
- Modify: `apps/admin-portal/src/app/[locale]/page.tsx` (redirect to login or dashboard)

**Step 1: Create login page**

```typescript
// apps/admin-portal/src/app/[locale]/login/page.tsx
'use client';

import { LoginForm, useAuth } from '@roviq/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@roviq/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as React from 'react';

export default function LoginPage() {
  const t = useTranslations('auth');
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (isAuthenticated) {
      const params = new URLSearchParams(window.location.search);
      router.replace(params.get('returnUrl') ?? '/dashboard');
    }
  }, [isAuthenticated, router]);

  const labels = {
    username: t('username'),
    password: t('password'),
    organizationId: t('organizationId'),
    enterUsername: t('enterUsername'),
    enterPassword: t('enterPassword'),
    enterOrganizationId: t('enterOrganizationId'),
    signIn: t('signIn'),
    signingIn: t('signingIn'),
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">{t('welcomeBack')}</CardTitle>
          <CardDescription>{t('loginDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm
            labels={labels}
            onSuccess={() => {
              const params = new URLSearchParams(window.location.search);
              router.replace(params.get('returnUrl') ?? '/dashboard');
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 2: Update landing page to redirect**

```typescript
// apps/admin-portal/src/app/[locale]/page.tsx
'use client';

import { useAuth } from '@roviq/auth';
import { useRouter } from 'next/navigation';
import * as React from 'react';

export default function Index() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (!isLoading) {
      router.replace(isAuthenticated ? '/dashboard' : '/login');
    }
  }, [isAuthenticated, isLoading, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
    </div>
  );
}
```

---

## Task 8: Create login page for institute-portal

**Files:**
- Create: `apps/institute-portal/src/app/[locale]/login/page.tsx`
- Modify: `apps/institute-portal/src/app/[locale]/page.tsx`

Same pattern as Task 7 but with "Roviq Institute" branding. The login page and redirect page are identical in structure.

---

## Task 9: Wire AuthProvider + GraphQLProvider into admin-portal layout

**Files:**
- Create: `apps/admin-portal/src/app/[locale]/providers.tsx`
- Modify: `apps/admin-portal/src/app/[locale]/layout.tsx`

Create a client component that composes both providers, then wrap the layout's children with it.

**Step 1: Create providers component**

```typescript
// apps/admin-portal/src/app/[locale]/providers.tsx
'use client';

import { AuthProvider, createAuthMutations, tokenStorage } from '@roviq/auth';
import { GraphQLProvider } from '@roviq/graphql';
import { useTranslations } from 'next-intl';
import * as React from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
const GRAPHQL_HTTP = `${API_URL}/api/graphql`;
const GRAPHQL_WS = GRAPHQL_HTTP.replace(/^http/, 'ws');

const authMutations = createAuthMutations(GRAPHQL_HTTP);

export function Providers({ children }: { children: React.ReactNode }) {
  const t = useTranslations('auth');

  const sessionExpiredLabels = React.useMemo(
    () => ({
      title: t('sessionExpired'),
      description: t('sessionExpiredDescription'),
      formLabels: {
        username: t('username'),
        password: t('password'),
        organizationId: t('organizationId'),
        enterUsername: t('enterUsername'),
        enterPassword: t('enterPassword'),
        enterOrganizationId: t('enterOrganizationId'),
        signIn: t('signIn'),
        signingIn: t('signingIn'),
      },
    }),
    [t],
  );

  return (
    <AuthProvider
      loginMutation={authMutations.login}
      refreshMutation={authMutations.refresh}
      logoutMutation={authMutations.logout}
      sessionExpiredLabels={sessionExpiredLabels}
    >
      <GraphQLProvider
        httpUrl={GRAPHQL_HTTP}
        wsUrl={GRAPHQL_WS}
        getAccessToken={() => tokenStorage.getAccessToken()}
        onAuthError={() => {
          // Handled by AuthProvider's session expired dialog
        }}
      >
        {children}
      </GraphQLProvider>
    </AuthProvider>
  );
}
```

**Step 2: Wrap layout children**

In `apps/admin-portal/src/app/[locale]/layout.tsx`, import `Providers` and wrap `{children}` inside `<NextIntlClientProvider>`:

```typescript
<NextIntlClientProvider locale={locale} messages={messages}>
  <Providers>{children}</Providers>
</NextIntlClientProvider>
```

---

## Task 10: Wire AuthProvider + GraphQLProvider into institute-portal layout

**Files:**
- Create: `apps/institute-portal/src/app/[locale]/providers.tsx`
- Modify: `apps/institute-portal/src/app/[locale]/layout.tsx`

Same pattern as Task 9.

---

## Task 11: Wrap dashboard layouts with ProtectedRoute

**Files:**
- Modify: `apps/admin-portal/src/app/[locale]/(dashboard)/layout.tsx`
- Modify: `apps/institute-portal/src/app/[locale]/(dashboard)/layout.tsx`

**Step 1: Wrap both dashboard layouts**

Add `ProtectedRoute` from `@roviq/auth` around `AdminLayout`:

```typescript
import { ProtectedRoute } from '@roviq/auth';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  // ... existing nav config ...

  return (
    <ProtectedRoute>
      <AdminLayout config={config}>{children}</AdminLayout>
    </ProtectedRoute>
  );
}
```

The `ProtectedRoute` defaults to `loginPath="/login"` which matches our new login route.

---

## Task 12: Wire topbar logout

**Files:**
- Modify: `libs/ui/src/components/layout/topbar.tsx`
- Modify: `libs/ui/src/components/layout/types.ts` (if needed)

The `UserMenu` currently has no click handlers. The topbar doesn't have access to `useAuth()` (it's in `@roviq/ui`, not `@roviq/auth`). Solution: accept `onLogout` callback via `LayoutConfig`.

**Step 1: Add onLogout to LayoutConfig**

Check `libs/ui/src/components/layout/types.ts` and add:
```typescript
onLogout?: () => void;
```

**Step 2: Thread onLogout through Topbar → UserMenu**

```typescript
function UserMenu({ onLogout }: { onLogout?: () => void }) {
  const t = useTranslations('auth');

  return (
    <DropdownMenu>
      {/* ... existing trigger ... */}
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>{t('myAccount')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>{t('profile')}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onLogout}>{t('logout')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Topbar({ config }: { config: LayoutConfig }) {
  // ... existing code ...
  <UserMenu onLogout={config.onLogout} />
}
```

**Step 3: Pass onLogout from dashboard layouts**

In both dashboard layouts, use `useAuth()` to get `logout` and pass it:

```typescript
import { useAuth } from '@roviq/auth';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { logout } = useAuth();
  // ...
  const config: LayoutConfig = {
    appName: tCommon('appName'),
    onLogout: logout,
    navGroups: [ /* ... */ ],
  };
  // ...
}
```

---

## Task 13: Add NEXT_PUBLIC_API_URL to env config

**Files:**
- Modify: `.env.development` (or create `.env.local` template)

Add `NEXT_PUBLIC_API_URL=http://localhost:3000` so both portals know where the API gateway is. The providers default to this value already, but it should be documented.

---

## Task 14: Update AuthProvider to accept sessionExpiredLabels

**Files:**
- Modify: `libs/auth/src/lib/auth-context.tsx`

The `AuthProvider` needs to accept `sessionExpiredLabels` prop and pass it to `SessionExpiredDialog`. Add to `AuthProviderProps`:

```typescript
sessionExpiredLabels?: SessionExpiredDialogProps['labels'];
```

And pass through:
```typescript
<SessionExpiredDialog
  open={sessionExpired}
  username={state.user?.username}
  onLoginSuccess={handleReLoginSuccess}
  labels={sessionExpiredLabels}
/>
```

This is part of Task 3 but listed explicitly for clarity.

---

## Task 15: Verify & lint

**Step 1: Run full gate**

```bash
bun run lint
bun run typecheck
bun run test
```

**Step 2: Check for "school" references**

```bash
git diff | grep -i "school"
```

Expected: zero results.

**Step 3: Check only expected files changed**

```bash
git diff --stat
```

---

## Execution Order

Tasks 1-2 are independent (can parallelize).
Task 3 depends on Task 2.
Tasks 4-6 are independent (can parallelize).
Tasks 7-8 depend on Tasks 1, 3, 5.
Tasks 9-10 depend on Task 1.
Tasks 11-12 are independent once providers exist.
Task 13 is independent.
Task 14 is part of Task 3.
Task 15 runs last.

**Parallel groups:**
1. Tasks 1, 2, 4, 13 (all independent)
2. Tasks 3, 5, 6 (depend on group 1)
3. Tasks 7, 8, 9, 10, 11, 12 (depend on group 2)
4. Task 15 (final verification)
