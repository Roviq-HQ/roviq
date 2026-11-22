'use client';

import { ProtectedRoute, useAuth } from '@roviq/auth';
import { NAV_SLUGS } from '@roviq/common-types';
import { gql, useQuery } from '@roviq/graphql';
import type { LayoutConfig, NavRegistryEntry } from '@roviq/ui';
import { AbilityProvider, AdminLayout } from '@roviq/ui';
import { NotificationBell } from '@web/components/notifications/notification-bell';
import {
  Building2,
  CreditCard,
  FileText,
  FolderTree,
  LayoutDashboard,
  ScrollText,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useLocaleChange } from '../../../../hooks/use-locale-change';
import { usePushNotifications } from '../../../../hooks/use-push-notifications';

const UNVERIFIED_COUNT_QUERY = gql`
  query UnverifiedPaymentsCount {
    unverifiedPayments(first: 100) {
      id
    }
  }
`;

// Hooks below (push registration, notification bell) call the API, so they run only once the route allows it.
export default function ResellerDashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <DashboardShell>{children}</DashboardShell>
    </ProtectedRoute>
  );
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('nav');
  const tCommon = useTranslations('common');
  const { logout, user } = useAuth();

  const { unregisterPushToken } = usePushNotifications();
  const changeLocale = useLocaleChange();
  const signOut = () => {
    unregisterPushToken();
    void logout();
  };

  const eeEnabled = process.env.NEXT_PUBLIC_ROVIQ_EE === 'true';

  const { data: unverifiedData } = useQuery<{
    unverifiedPayments: { id: string }[];
  }>(UNVERIFIED_COUNT_QUERY, { skip: !eeEnabled });
  const unverifiedCount = unverifiedData?.unverifiedPayments?.length ?? 0;

  // Reseller registry only includes slugs that map to real routes in this
  // portal. Reseller users don't manage students/staff/etc., so those slugs
  // are intentionally absent — if the server hands them down, BottomTabBar
  // silently drops anything missing from the registry.
  const NAV_REGISTRY: Record<string, NavRegistryEntry> = {
    [NAV_SLUGS.dashboard]: {
      href: '/dashboard',
      icon: LayoutDashboard,
      label: t('dashboard'),
    },
    [NAV_SLUGS.institutes]: {
      href: '/institutes',
      icon: Building2,
      label: t('institutes'),
      ability: { action: 'read', subject: 'Institute' },
    },
    [NAV_SLUGS.team]: {
      href: '/team',
      icon: Users,
      label: t('team'),
      ability: { action: 'read', subject: 'User' },
    },
    [NAV_SLUGS.billing]: {
      href: '/billing/dashboard',
      icon: CreditCard,
      label: t('billing'),
      ability: { action: 'read', subject: 'BillingDashboard' },
    },
    [NAV_SLUGS.subscriptions]: {
      href: '/billing/subscriptions',
      icon: CreditCard,
      label: t('subscriptions'),
      ability: { action: 'read', subject: 'Subscription' },
    },
    [NAV_SLUGS.invoices]: {
      href: '/billing/invoices',
      icon: FileText,
      label: t('invoices'),
      ability: { action: 'read', subject: 'Invoice' },
    },
    [NAV_SLUGS.audit]: {
      href: '/audit',
      icon: ScrollText,
      label: t('auditLogs'),
      ability: { action: 'read', subject: 'AuditLog' },
    },
    [NAV_SLUGS.settings]: {
      href: '/settings',
      icon: Settings,
      label: t('settings'),
    },
    [NAV_SLUGS.account]: {
      href: '/account',
      icon: UserCog,
      label: t('account'),
    },
  };

  const RESELLER_DEFAULT_SLUGS: string[] = [
    NAV_SLUGS.dashboard,
    NAV_SLUGS.institutes,
    NAV_SLUGS.team,
    NAV_SLUGS.billing,
  ];

  const config: LayoutConfig = {
    onLocaleChange: changeLocale,
    appName: tCommon('appNameReseller'),
    user: user ? { username: user.username, email: user.email } : undefined,
    onLogout: signOut,
    notificationBell: <NotificationBell />,
    navGroups: [
      {
        title: t('overview'),
        items: [
          { title: t('dashboard'), href: '/dashboard', icon: LayoutDashboard },
          { title: t('institutes'), href: '/institutes', icon: Building2 },
          { title: t('instituteGroups'), href: '/institute-groups', icon: FolderTree },
          { title: t('team'), href: '/team', icon: Users },
        ],
      },
      ...(eeEnabled
        ? [
            {
              title: t('billing'),
              items: [
                { title: t('billingDashboard'), href: '/billing/dashboard', icon: LayoutDashboard },
                { title: t('plans'), href: '/billing/plans', icon: CreditCard },
                { title: t('subscriptions'), href: '/billing/subscriptions', icon: CreditCard },
                { title: t('invoices'), href: '/billing/invoices', icon: FileText },
                { title: t('gatewayConfigs'), href: '/billing/gateway-configs', icon: Settings },
                {
                  title: t('upiVerification'),
                  href: '/billing/upi-verification',
                  icon: ShieldCheck,
                  badge: unverifiedCount > 0 ? String(unverifiedCount) : undefined,
                },
              ],
            },
          ]
        : []),
      {
        title: t('system'),
        items: [
          { title: t('auditLogs'), href: '/audit', icon: ScrollText },
          { title: t('settings'), href: '/settings', icon: Settings },
          { title: t('account'), href: '/account', icon: UserCog },
        ],
      },
    ],
    navRegistry: NAV_REGISTRY,
    bottomNav: {
      slugs: user?.primaryNavSlugs ?? [],
      defaultSlugs: RESELLER_DEFAULT_SLUGS,
      moreLabel: t('more'),
    },
    searchEnabled: true,
  };

  return (
    <AbilityProvider rules={user?.abilityRules ?? []}>
      <AdminLayout config={config}>{children}</AdminLayout>
    </AbilityProvider>
  );
}
