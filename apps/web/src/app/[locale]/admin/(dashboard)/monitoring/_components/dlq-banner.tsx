'use client';

import { Alert, AlertDescription, Button } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { Inbox } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

const { adminMonitoring: ids } = testIds;

export function DlqBanner({ count }: { count: number }) {
  const t = useTranslations('adminMonitoring.dlq');
  const locale = useLocale();
  if (count <= 0) return null;
  return (
    <Alert
      variant="destructive"
      role="alert"
      className="border-destructive/40 bg-destructive/10"
      data-testid={ids.dlqBanner}
    >
      <Inbox aria-hidden="true" />
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{t('banner', { count })}</span>
        <Button asChild variant="destructive" size="sm">
          <Link href={`/${locale}/admin/observability?tab=dlq`} data-testid={ids.dlqLink}>
            {t('action')}
          </Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
