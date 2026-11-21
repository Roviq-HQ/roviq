'use client';

import { createMongoAbility } from '@casl/ability';
import { ProtectedRoute, useAuth } from '@roviq/auth';
import { type AppAbility, NAV_SLUGS } from '@roviq/common-types';
import { useI18nField } from '@roviq/i18n';
import type { LayoutConfig, NavGroup, NavRegistryEntry } from '@roviq/ui';
import { AbilityProvider, AdminLayout } from '@roviq/ui';
import { ImpersonationBannerView } from '@web/components/impersonation/impersonation-banner';
import { useImpersonationSession } from '@web/components/impersonation/use-impersonation-session';
import { useRoleName } from '@web/hooks/use-role-name';
import {
  Award,
  BarChart3,
  Bell,
  Calendar,
  CalendarDays,
  CalendarOff,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  FileText,
  GraduationCap,
  History,
  LayoutDashboard,
  ListTree,
  Receipt,
  Settings,
  ShieldCheck,
  UserCheck,
  UserCog,
  UserPlus,
  UserRound,
  Users2,
  Wallet,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { useLocaleChange } from '../../../../hooks/use-locale-change';
import { usePushNotifications } from '../../../../hooks/use-push-notifications';
import { BillingRealtime } from './billing/billing-realtime';
import { useUnpaidInvoiceCount } from './billing/use-billing-realtime';
import { CurrentInstituteLocalesProvider } from './institute-locales-provider';
import { TenantThemeProvider } from './tenant-theme-provider';

function DashboardLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('nav');
  const tGroups = useTranslations('groups');
  const tCommon = useTranslations('common');
  const tAuth = useTranslations('auth');
  const impersonation = useImpersonationSession();
  const { logout, user, memberships, switchInstitute } = useAuth();
  const ti = useI18nField();
  const roleName = useRoleName();

  usePushNotifications();
  const changeLocale = useLocaleChange();

  const subscriberId = user?.id ?? '';
  const [subscriberHash, setSubscriberHash] = useState<string>();

  useEffect(() => {
    if (!subscriberId || !process.env.NEXT_PUBLIC_NOVU_APPLICATION_IDENTIFIER) return;
    fetch('/api/novu-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscriberId }),
    })
      .then((r) => r.json())
      .then((data) => setSubscriberHash(data.subscriberHash));
  }, [subscriberId]);

  const instituteSwitcher =
    memberships && memberships.length > 1 && user?.tenantId
      ? {
          currentTenantId: user.tenantId,
          currentInstituteName:
            ti(memberships.find((m) => m.tenantId === user.tenantId)?.instituteName) ?? '',
          memberships: memberships.map((m) => ({
            tenantId: m.tenantId,
            instituteName: ti(m.instituteName),
            instituteSlug: m.instituteSlug,
            instituteLogoUrl: m.instituteLogoUrl,
            roleName: roleName(m.roleName),
          })),
          onSwitch: (tenantId: string) => {
            const target = memberships?.find((m) => m.tenantId === tenantId);
            if (!target) return;
            switchInstitute(target.membershipId).then(() => window.location.reload());
          },
        }
      : undefined;

  const eeEnabled = process.env.NEXT_PUBLIC_ROVIQ_EE === 'true';
  const abilityRules = user?.abilityRules;
  const canReadInvoices = useMemo(
    () => createMongoAbility<AppAbility>(abilityRules ?? []).can('read', 'Invoice'),
    [abilityRules],
  );
  const unpaidInvoices = useUnpaidInvoiceCount(eeEnabled && canReadInvoices);

  // Slug → render-info map. Resolved by <BottomTabBar/> for the phone bottom
  // nav, and by future "more" surfaces. Labels come from the same `nav`
  // namespace already used by the desktop sidebar.
  const NAV_REGISTRY = {
    [NAV_SLUGS.dashboard]: {
      href: '/dashboard',
      icon: LayoutDashboard,
      label: t('dashboard'),
    },
    [NAV_SLUGS.students]: {
      href: '/people/students',
      icon: GraduationCap,
      label: t('students'),
      ability: { action: 'read', subject: 'Student' },
    },
    [NAV_SLUGS.staff]: {
      href: '/people/staff',
      icon: UserCog,
      label: t('staff'),
      ability: { action: 'read', subject: 'Staff' },
    },
    [NAV_SLUGS.guardians]: {
      href: '/people/guardians',
      icon: UserCheck,
      label: t('guardians'),
      ability: { action: 'read', subject: 'Guardian' },
    },
    [NAV_SLUGS.groups]: {
      href: '/groups',
      icon: Users2,
      label: tGroups('title'),
      ability: { action: 'read', subject: 'Group' },
    },
    [NAV_SLUGS.enquiries]: {
      href: '/admission/enquiries',
      icon: UserPlus,
      label: t('admissionEnquiries'),
      ability: { action: 'read', subject: 'Enquiry' },
    },
    [NAV_SLUGS.applications]: {
      href: '/admission/applications',
      icon: ClipboardList,
      label: t('admissionApplications'),
      ability: { action: 'read', subject: 'Application' },
    },
    [NAV_SLUGS.statistics]: {
      href: '/admission/statistics',
      icon: BarChart3,
      label: t('admissionStatistics'),
      ability: { action: 'read', subject: 'Enquiry' },
    },
    [NAV_SLUGS.academicYears]: {
      href: '/academic-years',
      icon: CalendarRange,
      label: t('academicYears'),
      ability: { action: 'read', subject: 'AcademicYear' },
    },
    [NAV_SLUGS.academics]: {
      href: '/academics',
      icon: GraduationCap,
      label: t('standards'),
      ability: { action: 'read', subject: 'Standard' },
    },
    [NAV_SLUGS.timetable]: {
      href: '/timetable',
      icon: Calendar,
      label: t('timetable'),
      ability: { action: 'read', subject: 'Timetable' },
    },
    [NAV_SLUGS.examinations]: {
      href: '/examinations',
      icon: GraduationCap,
      label: t('examinations'),
      ability: { action: 'read', subject: 'Exam' },
    },
    [NAV_SLUGS.reportCards]: {
      href: '/examinations/report-cards',
      icon: FileText,
      label: t('reportCards'),
      ability: { action: 'read', subject: 'ReportCard' },
    },
    [NAV_SLUGS.gradingSchemes]: {
      href: '/examinations/grading-schemes',
      icon: Award,
      label: t('gradingSchemes'),
      ability: { action: 'read', subject: 'GradingScheme' },
    },
    [NAV_SLUGS.myReportCards]: {
      href: '/examinations/report-cards/my',
      icon: FileText,
      label: t('myReportCards'),
      ability: { action: 'read', subject: 'ReportCard' },
    },
    [NAV_SLUGS.attendance]: {
      href: '/attendance',
      icon: ClipboardCheck,
      label: t('attendance'),
      ability: { action: 'read', subject: 'Attendance' },
    },
    [NAV_SLUGS.tc]: {
      href: '/certificates/tc',
      icon: FileText,
      label: t('tc'),
      ability: { action: 'read', subject: 'TC' },
    },
    [NAV_SLUGS.certificates]: {
      href: '/certificates/other',
      icon: Award,
      label: t('certificates'),
      ability: { action: 'read', subject: 'Certificate' },
    },
    [NAV_SLUGS.subscriptions]: {
      href: '/billing',
      icon: CreditCard,
      label: t('subscriptions'),
      ability: { action: 'read', subject: 'Subscription' },
    },
    [NAV_SLUGS.invoices]: {
      href: '/billing/invoices',
      icon: Receipt,
      label: t('invoices'),
      ability: { action: 'read', subject: 'Invoice' },
    },
    [NAV_SLUGS.payments]: {
      href: '/billing/payments',
      icon: Wallet,
      label: t('payments'),
      ability: { action: 'read', subject: 'Payment' },
    },
    [NAV_SLUGS.audit]: {
      href: '/audit',
      icon: FileText,
      label: t('auditLogs'),
      ability: { action: 'read', subject: 'AuditLog' },
    },
    [NAV_SLUGS.settings]: {
      href: '/settings',
      icon: Settings,
      label: t('settings'),
    },
    [NAV_SLUGS.notifications]: {
      href: '/settings/notifications',
      icon: Bell,
      label: t('notificationPreferences'),
    },
    [NAV_SLUGS.consent]: {
      href: '/settings/consent',
      icon: ShieldCheck,
      label: t('consent'),
      ability: { action: 'read', subject: 'Consent' },
    },
    [NAV_SLUGS.profile]: {
      href: '/profile',
      icon: UserRound,
      label: t('myProfile'),
    },
    [NAV_SLUGS.account]: {
      href: '/account',
      icon: UserCog,
      label: t('account'),
    },
  } satisfies Record<string, NavRegistryEntry>;

  // Sidebar items reuse the registry's ability, so a role never sees a link to a page it cannot open.
  const navItem = ({ label, href, icon, ability }: NavRegistryEntry) => ({
    title: label,
    href,
    icon,
    ability,
  });

  const INSTITUTE_DEFAULT_SLUGS: string[] = [
    NAV_SLUGS.dashboard,
    NAV_SLUGS.students,
    NAV_SLUGS.enquiries,
    NAV_SLUGS.academics,
  ];

  const config: LayoutConfig = {
    onLocaleChange: changeLocale,
    appName: tCommon('appNameInstitute'),
    user: user ? { username: user.username, email: user.email } : undefined,
    // Log out would sign the impersonator out of their own account; this tab only exits.
    onLogout: impersonation.active ? impersonation.exit : logout,
    logoutLabel: impersonation.active ? tAuth('exitImpersonation') : undefined,
    instituteSwitcher,
    notifications: process.env.NEXT_PUBLIC_NOVU_APPLICATION_IDENTIFIER
      ? {
          applicationIdentifier: process.env.NEXT_PUBLIC_NOVU_APPLICATION_IDENTIFIER,
          subscriberId,
          subscriberHash: subscriberHash ?? '',
          tenantId: user?.tenantId,
          backendUrl: process.env.NEXT_PUBLIC_NOVU_BACKEND_URL || undefined,
          socketUrl: process.env.NEXT_PUBLIC_NOVU_SOCKET_URL || undefined,
        }
      : undefined,
    navGroups: [
      {
        title: t('overview'),
        items: [navItem(NAV_REGISTRY.dashboard)],
      },
      {
        // People group bundles every human-record management page so the
        // sidebar mirrors the spec wording from ROV-167/169 ("People").
        title: t('people'),
        items: [
          navItem(NAV_REGISTRY.students),
          navItem(NAV_REGISTRY.staff),
          navItem(NAV_REGISTRY.guardians),
          navItem(NAV_REGISTRY.groups),
        ],
      },
      {
        // Admission group — ROV-168. Enquiries, applications, and funnel stats.
        title: t('admission'),
        items: [
          navItem(NAV_REGISTRY.enquiries),
          navItem(NAV_REGISTRY.applications),
          navItem(NAV_REGISTRY.statistics),
        ],
      },
      {
        title: t('academic'),
        items: [
          navItem(NAV_REGISTRY.academicYears),
          navItem(NAV_REGISTRY.academics),
          navItem(NAV_REGISTRY.timetable),
          {
            title: t('sectionTimetable'),
            href: '/timetable/section-timetable',
            icon: CalendarRange,
          },
          { title: t('staffTimetable'), href: '/timetable/staff-timetable', icon: CalendarRange },
          { title: t('dayTimetable'), href: '/timetable/day', icon: CalendarDays },
          navItem(NAV_REGISTRY.examinations),
          navItem(NAV_REGISTRY.reportCards),
          navItem(NAV_REGISTRY.gradingSchemes),
          navItem(NAV_REGISTRY.myReportCards),
          navItem(NAV_REGISTRY.attendance),
          {
            title: t('attendanceHistory'),
            href: '/attendance/history',
            icon: History,
            // Same check as the page, so a role without it is not offered a dead end.
            ability: { action: 'read', subject: 'Attendance' },
          },
          { title: t('leave'), href: '/leave', icon: CalendarOff },
          { title: t('holidays'), href: '/holiday', icon: CalendarDays },
          navItem(NAV_REGISTRY.tc),
          navItem(NAV_REGISTRY.certificates),
        ],
      },
      ...(eeEnabled
        ? ([
            {
              title: t('billing'),
              items: [
                navItem(NAV_REGISTRY.subscriptions),
                {
                  ...navItem(NAV_REGISTRY.invoices),
                  badge: unpaidInvoices > 0 ? String(unpaidInvoices) : undefined,
                },
                navItem(NAV_REGISTRY.payments),
              ],
            },
          ] satisfies NavGroup[])
        : []),
      {
        title: t('system'),
        items: [
          navItem(NAV_REGISTRY.audit),
          navItem(NAV_REGISTRY.settings),
          navItem(NAV_REGISTRY.notifications),
          navItem(NAV_REGISTRY.consent),
          { title: t('roleNav'), href: '/settings/roles', icon: ListTree },
          navItem(NAV_REGISTRY.profile),
          navItem(NAV_REGISTRY.account),
        ],
      },
    ],
    navRegistry: NAV_REGISTRY,
    bottomNav: {
      slugs: user?.primaryNavSlugs ?? [],
      defaultSlugs: INSTITUTE_DEFAULT_SLUGS,
      moreLabel: t('more'),
    },
    searchEnabled: true,
  };

  return (
    <ProtectedRoute>
      <AbilityProvider rules={user?.abilityRules ?? []}>
        <TenantThemeProvider>
          {eeEnabled && <BillingRealtime />}
          <AdminLayout
            config={config}
            banner={
              impersonation.active ? <ImpersonationBannerView session={impersonation} /> : undefined
            }
          >
            {children}
          </AdminLayout>
        </TenantThemeProvider>
      </AbilityProvider>
    </ProtectedRoute>
  );
}

export default function InstituteDashboard({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <CurrentInstituteLocalesProvider>
        <DashboardLayout>{children}</DashboardLayout>
      </CurrentInstituteLocalesProvider>
    </ProtectedRoute>
  );
}
