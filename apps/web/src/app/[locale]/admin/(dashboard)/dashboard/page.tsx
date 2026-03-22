'use client';

import { Link } from '@roviq/i18n';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@roviq/ui';
import { Building2, FileText, Settings, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';

export default function AdminDashboardPage() {
  const t = useTranslations('dashboard');

  const quickLinks = [
    {
      title: t('manageInstitutes'),
      description: t('manageInstitutesDescription'),
      href: '/institutes',
      icon: Building2,
    },
    {
      title: t('manageUsers'),
      description: t('manageUsersDescription'),
      href: '/users',
      icon: Users,
    },
    {
      title: t('viewAuditLogs'),
      description: t('viewAuditLogsDescription'),
      href: '/audit-logs',
      icon: FileText,
    },
    {
      title: t('viewSettings'),
      description: t('viewSettingsDescription'),
      href: '/settings',
      icon: Settings,
    },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{t('platformWelcome')}</CardTitle>
          <CardDescription>{t('platformWelcomeDescription')}</CardDescription>
        </CardHeader>
      </Card>
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
