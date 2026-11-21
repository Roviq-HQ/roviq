'use client';

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { ShieldOff } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function TcAccessDenied() {
  const t = useTranslations('certificates');
  return (
    <Empty className="py-12" data-testid={testIds.instituteCertificatesTc.accessDenied}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ShieldOff />
        </EmptyMedia>
        <EmptyTitle>{t('tc.accessDenied.title')}</EmptyTitle>
        <EmptyDescription>{t('tc.accessDenied.description')}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
