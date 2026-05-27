'use client';

import { LoginForm, sanitizeReturnUrl, useAuth } from '@roviq/auth';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@roviq/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';

const { auth } = testIds;
export default function LoginPage() {
  const t = useTranslations('auth');
  const { isAuthenticated, needsInstituteSelection, login } = useAuth();
  const router = useRouter();
  const [quickLoading, setQuickLoading] = React.useState<string | null>(null);

  // Dev-only one-click sign-in for the seeded accounts (gated to non-production below).
  const devUsers = [
    { role: t('devRoleAdmin'), username: 'admin', password: 'admin123', hint: t('devHintPicker') },
    {
      role: t('devRoleTeacher'),
      username: 'teacher1',
      password: 'teacher123',
      hint: t('devHintDirect'),
    },
    {
      role: t('devRoleStudent'),
      username: 'student1',
      password: 'student123',
      hint: t('devHintDirect'),
    },
  ];
  const quickLogin = async (user: { username: string; password: string }) => {
    setQuickLoading(user.username);
    try {
      await login({ username: user.username, password: user.password });
    } catch {
      setQuickLoading(null);
      toast.error(t('loginFailed'));
    }
  };

  React.useEffect(() => {
    const returnUrl = sanitizeReturnUrl(
      new URLSearchParams(window.location.search).get('returnUrl'),
    );
    if (needsInstituteSelection) {
      // Carry the post-login target through institute selection so the user lands
      // on the page they originally requested, not a hardcoded dashboard.
      router.replace(
        returnUrl
          ? `/select-institute?returnUrl=${encodeURIComponent(returnUrl)}`
          : '/select-institute',
      );
      return;
    }
    if (isAuthenticated) {
      router.replace(returnUrl ?? '/dashboard');
    }
  }, [isAuthenticated, needsInstituteSelection, router]);

  const labels = {
    username: t('username'),
    password: t('password'),
    enterUsername: t('enterUsername'),
    enterPassword: t('enterPassword'),
    signIn: t('signIn'),
    signingIn: t('signingIn'),
    signInWithPasskey: t('signInWithPasskey'),
    or: t('or'),
    usernameRequired: t('usernameRequired'),
    passwordRequired: t('passwordRequired'),
    loginFailed: t('loginFailed'),
    passkeyNotAvailable: t('passkeyNotAvailable'),
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-md space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl" data-testid={auth.loginTitle}>
              {t('welcomeBack')}
            </CardTitle>
            <CardDescription data-testid={auth.loginDescription}>
              {t('loginDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Post-login navigation (incl. multi-institute selection + returnUrl) is
                handled by the effect above, which reacts to the auth state reliably. */}
            <LoginForm scope="institute" labels={labels} />
          </CardContent>
        </Card>
        {process.env.NODE_ENV !== 'production' && (
          <Card className="border-dashed border-muted-foreground/40 bg-muted/30">
            <CardContent className="pt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('devCredentials')}
              </p>
              <div className="space-y-1.5">
                {devUsers.map((user) => (
                  <Button
                    key={user.username}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={quickLoading !== null}
                    onClick={() => quickLogin(user)}
                    className="flex h-auto w-full items-center justify-between gap-2 font-mono text-xs"
                    data-testid={auth.devQuickLogin(user.username)}
                  >
                    <span>
                      <span className="font-medium">{user.username}</span> / {user.password}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {quickLoading === user.username ? t('signingIn') : user.hint}
                    </span>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

import { testIds } from '@roviq/ui/testing/testid-registry';
