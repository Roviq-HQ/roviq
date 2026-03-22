'use client';

import { Link } from '@roviq/i18n';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@roviq/ui';
import { Building2, Settings, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';

export default function ResellerDashboardPage() {
  const t = useTranslations('dashboard');

  const quickLinks = [
    { title: t('viewInstitutes'), href: '/institutes', icon: Building2 },
    { title: t('manageTeam'), href: '/team', icon: Users },
    { title: t('viewSettings'), href: '/settings', icon: Settings },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{t('resellerWelcome')}</CardTitle>
          <CardDescription>{t('resellerWelcomeDescription')}</CardDescription>
        </CardHeader>
      </Card>
      <div>
        <CardTitle className="mb-4 text-lg">{t('quickLinks')}</CardTitle>
        <div className="grid gap-4 md:grid-cols-3">
          {quickLinks.map((link) => (
            <Card key={link.href}>
              <CardContent className="flex items-center gap-3 pt-6">
                <link.icon className="size-5 text-muted-foreground" />
                <Button variant="link" className="h-auto p-0" asChild>
                  <Link href={link.href}>{link.title}</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
