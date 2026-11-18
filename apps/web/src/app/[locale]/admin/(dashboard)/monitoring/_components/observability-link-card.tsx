'use client';

import { Button, Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { ArrowRight, BarChart2 } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

export function ObservabilityLinkCard() {
  const t = useTranslations('adminMonitoring.observability');
  const locale = useLocale();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart2 className="size-4 text-muted-foreground" aria-hidden="true" />
          {t('heading')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardFooter>
        <Button asChild variant="outline">
          <Link
            href={`/${locale}/admin/observability`}
            data-testid={testIds.adminMonitoring.observabilityLink}
          >
            {t('action')}
            <ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
