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
