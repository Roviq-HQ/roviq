'use client';

import { LoginForm } from '@roviq/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@roviq/ui/components/ui/card';
import { useTranslations } from 'next-intl';

export default function ResellerLoginPage() {
  const t = useTranslations('auth');

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('resellerLogin')}</CardTitle>
        </CardHeader>
        <CardContent>
          <LoginForm scope="reseller" />
        </CardContent>
      </Card>
    </div>
  );
}
