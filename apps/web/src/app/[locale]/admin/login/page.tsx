'use client';

import { LoginForm } from '@roviq/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@roviq/ui/components/ui/card';
import { useTranslations } from 'next-intl';

export default function AdminLoginPage() {
  const t = useTranslations('auth');

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('platformLogin')}</CardTitle>
        </CardHeader>
        <CardContent>
          <LoginForm scope="platform" />
        </CardContent>
      </Card>
    </div>
  );
}
