'use client';

import { Badge } from '@roviq/ui';
import { useRoleName } from '@web/hooks/use-role-name';
import { useTranslations } from 'next-intl';

const ROLE_CLASS: Record<string, string> = {
  reseller_full_admin: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  reseller_support_admin: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  reseller_viewer: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

type RoleName = Record<string, string> | null | undefined;

export function TeamRoleBadge({ name, testId }: { name: RoleName; testId?: string }) {
  const roleName = useRoleName();
  return (
    <Badge variant="secondary" className={ROLE_CLASS[name?.en ?? ''] ?? ''} data-testid={testId}>
      {roleName(name) || '—'}
    </Badge>
  );
}

export function TeamStatusBadge({ isActive, testId }: { isActive: boolean; testId?: string }) {
  const t = useTranslations('resellerTeam.status');
  return (
    <Badge
      variant={isActive ? 'secondary' : 'outline'}
      className={
        isActive ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : ''
      }
      data-testid={testId}
    >
      {isActive ? t('active') : t('inactive')}
    </Badge>
  );
}
