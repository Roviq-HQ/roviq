'use client';

import { Link, usePathname } from '@roviq/i18n';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useTranslations } from 'next-intl';

const { resellerSettings } = testIds;

const TABS = [
  { key: 'profile', href: '/settings/profile' },
  { key: 'branding', href: '/settings/branding' },
  { key: 'customDomain', href: '/settings/custom-domain' },
  { key: 'sessions', href: '/settings/sessions' },
] as const;

export default function ResellerSettingsLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('resellerSettings');
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid={resellerSettings.title}>
          {t('title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <nav
        aria-label={t('tabs.label')}
        className="flex gap-1 overflow-x-auto overflow-y-hidden border-b"
        data-testid={resellerSettings.tabs}
      >
        {TABS.map((tab) => {
          const active = pathname.endsWith(tab.href);
          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              data-testid={resellerSettings.tab(tab.key)}
              className={`flex min-h-11 items-center whitespace-nowrap border-b-2 px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t(`tabs.${tab.key}`)}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
