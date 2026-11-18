'use client';

import { useFormatNumber } from '@roviq/i18n';
import { Button, Card, CardContent, Skeleton } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { Activity, Building2, UserPlus, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useUserStatistics } from './use-users';

const { adminUsers } = testIds;

const CARDS = [
  { key: 'total', field: 'totalUsers', icon: Users },
  { key: 'active', field: 'activeThisMonth', icon: Activity },
  { key: 'new', field: 'newThisWeek', icon: UserPlus },
  { key: 'multi', field: 'multiInstituteUsers', icon: Building2 },
] as const;

export function UserStats() {
  const t = useTranslations('adminUsers.stats');
  const { format } = useFormatNumber();
  const { data, loading, error, refetch } = useUserStatistics();
  const stats = data?.adminUserStatistics;

  if (error && !stats) {
    return (
      <Card data-testid={adminUsers.statsError}>
        <CardContent className="flex items-center justify-between gap-4 py-4 text-sm">
          <span className="text-muted-foreground">{t('loadFailed')}</span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            {t('retry')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {CARDS.map(({ key, field, icon: Icon }) => (
        <Card key={key} data-testid={adminUsers.stat(key)}>
          <CardContent className="flex items-start justify-between gap-2 py-4">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">{t(`${key}.label`)}</p>
              {loading && !stats ? (
                <Skeleton className="mt-1 h-7 w-16" />
              ) : (
                <p className="text-2xl font-semibold tabular-nums">{format(stats?.[field] ?? 0)}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">{t(`${key}.hint`)}</p>
            </div>
            <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
