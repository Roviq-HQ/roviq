'use client';

import { useFormatDate, useI18nField } from '@roviq/i18n';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Card,
  CardContent,
  Separator,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useTranslations } from 'next-intl';
import { formatPhone, type UserDetail } from '../../types';
import { USER_STATUS_CLASS, USER_STATUS_VARIANT } from '../../user-badge-styles';

const { adminUserDetail } = testIds;

export function useUserDisplayName() {
  const resolveI18n = useI18nField();
  return (user: Pick<UserDetail, 'profile' | 'username'>) =>
    user.profile
      ? [resolveI18n(user.profile.firstName), resolveI18n(user.profile.lastName)]
          .filter(Boolean)
          .join(' ')
      : user.username;
}

export function ProfileCard({ user }: { user: UserDetail }) {
  const t = useTranslations('adminUsers');
  const { format, formatDistance } = useFormatDate();
  const displayName = useUserDisplayName();
  const name = displayName(user);
  const profile = user.profile;

  const rows: Array<[string, string | null | undefined]> = [
    [t('profile.email'), user.email],
    [t('profile.phone'), formatPhone(user.primaryPhone)],
    [
      t('profile.dateOfBirth'),
      profile?.dateOfBirth ? format(new Date(profile.dateOfBirth), 'dd/MM/yyyy') : null,
    ],
    [t('profile.gender'), profile?.gender ? t(`genders.${profile.gender}`) : null],
    [t('profile.nationality'), profile?.nationality],
    [t('profile.joined'), format(new Date(user.createdAt), 'dd/MM/yyyy')],
    [
      t('profile.lastActive'),
      user.lastActiveAt
        ? formatDistance(new Date(user.lastActiveAt), new Date())
        : t('neverActive'),
    ],
  ];

  return (
    <Card data-testid={adminUserDetail.profileCard}>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <Avatar className="size-20">
            {profile?.profileImage?.url && (
              <AvatarImage src={profile.profileImage?.url} alt={name} />
            )}
            <AvatarFallback className="text-lg">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <h1 className="text-xl font-semibold" data-testid={adminUserDetail.name}>
            {name}
          </h1>
          <p
            className="font-mono text-xs text-muted-foreground"
            title={t('profile.roviqId')}
            data-testid={adminUserDetail.username}
          >
            {user.username}
          </p>
          <Badge
            variant={USER_STATUS_VARIANT[user.status]}
            className={USER_STATUS_CLASS[user.status]}
            data-testid={adminUserDetail.statusBadge}
          >
            {t(`statuses.${user.status}`)}
          </Badge>
        </div>
        <Separator />
        <dl className="space-y-3 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words text-end">{value || '—'}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
