import type { MembershipStatus, UserStatus } from '@roviq/graphql/generated';

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

export const USER_STATUS_VARIANT: Record<UserStatus, BadgeVariant> = {
  ACTIVE: 'default',
  SUSPENDED: 'destructive',
  LOCKED: 'secondary',
};

export const USER_STATUS_CLASS: Record<UserStatus, string> = {
  ACTIVE: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  SUSPENDED: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  LOCKED: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
};

export const MEMBERSHIP_STATUS_VARIANT: Record<MembershipStatus, BadgeVariant> = {
  ACTIVE: 'default',
  REVOKED: 'outline',
  SUSPENDED: 'destructive',
};
