'use client';

import { createMongoAbility } from '@casl/ability';
import { ProtectedRoute, useAuth } from '@roviq/auth';
import { type AppAbility, NAV_SLUGS } from '@roviq/common-types';
import { gql, useQuery } from '@roviq/graphql';
import type { LayoutConfig, NavGroup, NavRegistryEntry } from '@roviq/ui';
import { AbilityProvider, AdminLayout } from '@roviq/ui';
import {
  DisplaySettingsProvider,
  useDisplaySettings,
} from '@web/components/display-settings/display-settings-context';
import { LiveConnectionIndicator } from '@web/components/live-updates/live-connection-indicator';
import { LiveUpdatesBanner } from '@web/components/live-updates/live-updates-banner';
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
  SlidersHorizontal,
  UserCog,
  Users,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
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
      <DisplaySettingsProvider>
        <DashboardShell>{children}</DashboardShell>
      </DisplaySettingsProvider>
    </ProtectedRoute>
  );
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('nav');
  const tCommon = useTranslations('common');
  const tQuick = useTranslations('common.quickActions');
  const { openDisplaySettings } = useDisplaySettings();
  const { logout, user } = useAuth();

  const { unregisterPushToken } = usePushNotifications();
  const changeLocale = useLocaleChange();
  const signOut = () => {
    unregisterPushToken();
    void logout();
  };

  const eeEnabled = process.env.NEXT_PUBLIC_ROVIQ_EE === 'true';
  const abilityRules = user?.abilityRules;
  const canReadPayments = useMemo(
    () => createMongoAbility<AppAbility>(abilityRules ?? []).can('read', 'Payment'),
    [abilityRules],
  );

  const { data: unverifiedData } = useQuery<{
    unverifiedPayments: { id: string }[];
  }>(UNVERIFIED_COUNT_QUERY, { skip: !eeEnabled || !canReadPayments });
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
      ability: { action: 'read', subject: 'ResellerTeam' },
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
    connectionIndicator: <LiveConnectionIndicator />,
    quickActions: [
      {
        id: 'display-settings',
        title: tQuick('displaySettings'),
        icon: SlidersHorizontal,
        onSelect: openDisplaySettings,
      },
    ],
    navGroups: [
      {
        title: t('overview'),
        items: [
          { title: t('dashboard'), href: '/dashboard', icon: LayoutDashboard },
          {
            title: t('institutes'),
            href: '/institutes',
            icon: Building2,
            ability: { action: 'read', subject: 'Institute' },
          },
          {
            title: t('instituteGroups'),
            href: '/institute-groups',
            icon: FolderTree,
            ability: { action: 'read', subject: 'InstituteGroup' },
          },
          {
            title: t('team'),
            href: '/team',
            icon: Users,
            ability: { action: 'read', subject: 'ResellerTeam' },
          },
        ],
      },
      ...(eeEnabled
        ? [
            {
              title: t('billing'),
              items: [
                {
                  title: t('billingDashboard'),
                  href: '/billing/dashboard',
                  icon: LayoutDashboard,
                  ability: { action: 'read', subject: 'BillingDashboard' },
                },
                {
                  title: t('plans'),
                  href: '/billing/plans',
                  icon: CreditCard,
                  ability: { action: 'read', subject: 'SubscriptionPlan' },
                },
                {
                  title: t('subscriptions'),
                  href: '/billing/subscriptions',
                  icon: CreditCard,
                  ability: { action: 'read', subject: 'Subscription' },
                },
                {
                  title: t('invoices'),
                  href: '/billing/invoices',
                  icon: FileText,
                  ability: { action: 'read', subject: 'Invoice' },
                },
                {
                  title: t('gatewayConfigs'),
                  href: '/billing/gateway-configs',
                  icon: Settings,
                  ability: { action: 'read', subject: 'PaymentGatewayConfig' },
                },
                {
                  title: t('upiVerification'),
                  href: '/billing/upi-verification',
                  icon: ShieldCheck,
                  ability: { action: 'read', subject: 'Payment' },
                  badge: unverifiedCount > 0 ? String(unverifiedCount) : undefined,
                },
              ],
            } satisfies NavGroup,
          ]
        : []),
      {
        title: t('system'),
        items: [
          {
            title: t('auditLogs'),
            href: '/audit',
            icon: ScrollText,
            ability: { action: 'read', subject: 'AuditLog' },
          },
          {
            title: t('settings'),
            href: '/settings',
            icon: Settings,
          },
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
      <AdminLayout config={config} banner={<LiveUpdatesBanner />}>
        {children}
      </AdminLayout>
    </AbilityProvider>
  );
}
