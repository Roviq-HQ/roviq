'use client';

import { PasswordChangeForm, useAuth } from '@roviq/auth';
import { Button } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { usePasswordChangeLabels } from '@web/hooks/use-password-change-labels';
import { CheckCircle2, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as React from 'react';

const { forcedPasswordChange: ids } = testIds;

/** How long the confirmation stays before the user is sent to sign in. */
const REDIRECT_AFTER_MS = 4000;

/**
 * The only screen an account with a temporary password can use. The change signs every
 * session out, so on success it confirms and sends the user to this portal's sign-in.
 */
export function ForcedPasswordChange() {
  const t = useTranslations('auth.forcedPasswordChange');
  const labels = usePasswordChangeLabels();
  const { isLoading, isAuthenticated, mustChangePassword, logout } = useAuth();
  const router = useRouter();
  // The change ends the session; remembering that it was forced tells success from a sign-out.
  const wasRequired = React.useRef(false);
  const signingOut = React.useRef(false);
  if (mustChangePassword) wasRequired.current = true;
  const changed = !isLoading && !isAuthenticated && wasRequired.current && !signingOut.current;

  React.useEffect(() => {
    if (isLoading) return;
    if (isAuthenticated && !mustChangePassword) {
      router.replace('/dashboard');
      return;
    }
    if (!isAuthenticated && !changed) {
      router.replace('/login');
    }
  }, [isLoading, isAuthenticated, mustChangePassword, changed, router]);

  React.useEffect(() => {
    if (!changed) return;
    const timer = setTimeout(() => router.replace('/login'), REDIRECT_AFTER_MS);
    return () => clearTimeout(timer);
  }, [changed, router]);

  const signOut = async () => {
    signingOut.current = true;
    await logout();
    router.replace('/login');
  };

  if (changed) {
    return (
      <Screen>
        <div
          role="status"
          className="space-y-4 rounded-lg border bg-card p-6 text-center"
          data-testid={ids.success}
        >
          <CheckCircle2 className="mx-auto size-10 text-emerald-600" aria-hidden="true" />
          <h1 className="text-xl font-semibold">{t('successTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('successBody')}</p>
          <Button onClick={() => router.replace('/login')} data-testid={ids.signInBtn}>
            {t('goToSignIn')}
          </Button>
        </div>
      </Screen>
    );
  }

  if (!mustChangePassword) return null;

  return (
    <Screen>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight" data-testid={ids.title}>
          {t('title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>
      <PasswordChangeForm
        labels={{
          ...labels,
          title: t('formTitle'),
          description: t('formDescription'),
          currentPassword: t('currentPassword'),
        }}
      />
      <Button
        variant="ghost"
        className="w-full"
        onClick={signOut}
        title={t('signOutHint')}
        data-testid={ids.signOutBtn}
      >
        <LogOut className="size-4" aria-hidden="true" />
        {t('signOut')}
      </Button>
    </Screen>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <main
      className="flex min-h-screen items-center justify-center bg-background px-4 py-8"
      data-testid={ids.page}
    >
      <div className="w-full max-w-md space-y-4">{children}</div>
    </main>
  );
}
