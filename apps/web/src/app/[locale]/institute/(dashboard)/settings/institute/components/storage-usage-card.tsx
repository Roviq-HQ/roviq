'use client';

import { gql, useQuery } from '@roviq/graphql';
import { useFormatNumber } from '@roviq/i18n';
import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
  Skeleton,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { formatBytes } from '@web/lib/format-bytes';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { InstituteStorageUsageDocument } from './storage-usage-card.generated';

const { instituteSettings: ids } = testIds;

export const STORAGE_WARNING_RATIO = 0.8;

export const INSTITUTE_STORAGE_USAGE = gql`
  query InstituteStorageUsage {
    storageUsage {
      usedBytes
      limitBytes
    }
  }
`;

export function StorageUsageCard() {
  const t = useTranslations('instituteSettings.storage');
  const { format, percent } = useFormatNumber();
  const { data, loading, error } = useQuery(InstituteStorageUsageDocument, {
    fetchPolicy: 'cache-and-network',
  });
  const usage = data?.storageUsage;

  if (!usage && loading) return <Skeleton className="h-28 w-full" />;
  if (!usage) {
    return error ? (
      <Alert variant="destructive">
        <AlertDescription>{t('failed')}</AlertDescription>
      </Alert>
    ) : null;
  }

  const used = formatBytes(usage.usedBytes, format);
  const ratio = usage.limitBytes ? usage.usedBytes / usage.limitBytes : null;
  const full = ratio !== null && ratio >= 1;
  const near = ratio !== null && ratio >= STORAGE_WARNING_RATIO;

  return (
    <Card data-testid={ids.storageCard}>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('hint')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm font-medium tabular-nums" data-testid={ids.storageUsed}>
          {usage.limitBytes === null
            ? t('usedUnlimited', { used })
            : t('usedOfLimit', { used, limit: formatBytes(usage.limitBytes, format) })}
        </p>
        {ratio !== null ? (
          <Progress
            value={Math.min(100, ratio * 100)}
            aria-label={t('barLabel', { percent: percent(ratio) })}
            className={full ? '[&>div]:bg-destructive' : near ? '[&>div]:bg-amber-500' : undefined}
            data-testid={ids.storageBar}
          />
        ) : null}
        {near ? (
          <Alert variant={full ? 'destructive' : 'default'} data-testid={ids.storageWarning}>
            <AlertTriangle aria-hidden="true" />
            <AlertDescription>{t(full ? 'atLimit' : 'nearLimit')}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
