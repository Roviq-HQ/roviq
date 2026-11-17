'use client';

import { useAuth } from '@roviq/auth';
import { gql, useQuery } from '@roviq/graphql';
import { InstituteLocalesProvider } from '@roviq/i18n';
import { Button, Skeleton } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { InstituteLocalesDocument } from './institute-locales-provider.generated';

export const INSTITUTE_LOCALES = gql`
  query InstituteLocales {
    myInstitute { id supportedLocales defaultLocale }
  }
`;

export function CurrentInstituteLocalesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const t = useTranslations('instituteSettings.languages');
  const { data, error, refetch } = useQuery(InstituteLocalesDocument, {
    skip: !user?.tenantId,
    fetchPolicy: 'cache-and-network',
  });
  const institute = data?.myInstitute;
  if (!user?.tenantId || institute?.id !== user.tenantId) {
    if (error)
      return (
        <div role="alert" data-testid={testIds.instituteLocales.error}>
          {t('loadFailed')}
          <Button
            title={t('retry')}
            data-testid={testIds.instituteLocales.retry}
            onClick={() => void refetch()}
          >
            {t('retry')}
          </Button>
        </div>
      );
    return <Skeleton className="h-40 w-full" data-testid={testIds.instituteLocales.loading} />;
  }
  return <InstituteLocalesProvider value={institute}>{children}</InstituteLocalesProvider>;
}
