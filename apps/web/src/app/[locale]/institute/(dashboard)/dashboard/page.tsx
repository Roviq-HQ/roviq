'use client';

import { Link } from '@roviq/i18n';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@roviq/ui';
import { BookOpen, GraduationCap, Settings, UserCheck, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';

export default function DashboardPage() {
  const t = useTranslations('dashboard');

  const quickLinks = [
    {
      title: t('manageStandards'),
      description: t('manageStandardsDescription'),
      href: '/standards',
      icon: GraduationCap,
    },
    {
      title: t('manageSubjects'),
      description: t('manageSubjectsDescription'),
      href: '/subjects',
      icon: BookOpen,
    },
    {
      title: t('manageUsers'),
      description: t('instituteManageUsersDescription'),
      href: '/users',
      icon: Users,
    },
    {
      title: t('viewSettings'),
      description: t('instituteViewSettingsDescription'),
      href: '/settings',
      icon: Settings,
    },
  ];

  const emptyStates = [
    {
      title: t('emptyStudentsTitle'),
      description: t('emptyStudentsDescription'),
      cta: t('emptyStudentsCta'),
      href: '/students',
      icon: Users,
    },
    {
      title: t('emptyTeachersTitle'),
      description: t('emptyTeachersDescription'),
      cta: t('emptyTeachersCta'),
      href: '/teachers',
      icon: UserCheck,
    },
    {
      title: t('emptyStandardsTitle'),
      description: t('emptyStandardsDescription'),
      cta: t('emptyStandardsCta'),
      href: '/standards',
      icon: GraduationCap,
    },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{t('instituteWelcome')}</CardTitle>
          <CardDescription>{t('instituteWelcomeDescription')}</CardDescription>
        </CardHeader>
      </Card>
      <div>
        <CardTitle className="mb-4 text-lg">{t('getStarted')}</CardTitle>
        <div className="grid gap-4 md:grid-cols-3">
          {emptyStates.map((state) => (
            <Card key={state.href}>
              <CardContent className="flex flex-col items-center gap-3 pt-6 text-center">
                <state.icon className="size-8 text-muted-foreground" />
                <CardTitle className="text-base">{state.title}</CardTitle>
                <CardDescription>{state.description}</CardDescription>
                <Button variant="outline" size="sm" asChild>
                  <Link href={state.href}>{state.cta}</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
      <div>
        <CardTitle className="mb-4 text-lg">{t('quickLinks')}</CardTitle>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {quickLinks.map((link) => (
            <Card key={link.href}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <link.icon className="size-5 text-muted-foreground" />
                  <CardTitle className="text-base">
                    <Button variant="link" className="h-auto p-0" asChild>
                      <Link href={link.href}>{link.title}</Link>
                    </Button>
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription>{link.description}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
