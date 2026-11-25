'use client';

import { useTranslations } from 'next-intl';

import * as React from 'react';
import { cn } from '../../lib/utils';
import { useAbility } from '../auth/ability-provider';
import { BottomTabBar } from './bottom-tab-bar';
import { CommandPalette } from './command-palette';
import { PageErrorBoundary } from './error-boundary';
import { DesktopSidebar, SidebarProvider } from './sidebar';
import { Topbar } from './topbar';
import type { LayoutConfig } from './types';

export function AdminLayout({
  config: rawConfig,
  banner,
  children,
}: {
  config: LayoutConfig;
  /** Full-width strip above the sidebar and top bar; it takes its own row, covering nothing. */
  banner?: React.ReactNode;
  children: React.ReactNode;
}) {
  const config = useAbilityFilteredConfig(rawConfig);
  const tError = useTranslations('error');
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  return (
    <SidebarProvider>
      {/* Skip link — visible only when focused, lets keyboard users jump
            straight to the main content past the sidebar + topbar. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow-lg"
      >
        Skip to main
      </a>
      {/* App chrome hides in print so window.print() outputs page content
            only. `contents` keeps flex layout untouched on screen. The scroll
            containers below must also release their clipping, otherwise only
            the visible viewport prints. */}
      <div className="flex h-screen flex-col overflow-hidden print:block print:h-auto print:overflow-visible">
        {banner && <div className="shrink-0 print:hidden">{banner}</div>}
        <div className="flex min-h-0 flex-1 overflow-hidden print:block print:overflow-visible">
          <div className="contents print:hidden">
            <DesktopSidebar config={config} />
          </div>
          <div className="flex flex-1 flex-col overflow-hidden print:overflow-visible">
            <div className="contents print:hidden">
              <Topbar config={config} onOpenQuickActions={() => setPaletteOpen(true)} />
            </div>
            {config.bottomNav && config.navRegistry && (
              <div className="contents print:hidden">
                <BottomTabBar bottomNav={config.bottomNav} navRegistry={config.navRegistry} />
              </div>
            )}
            <main
              id="main-content"
              tabIndex={-1}
              className={cn(
                'flex-1 overflow-y-auto p-4 md:p-6 print:h-auto print:overflow-visible',
                // Content scrolls under the fixed bottom-tab bar so its
                // backdrop-blur picks up the page. The end padding lets the
                // last control (a Save button) come to rest above the bar;
                // scroll-padding alone does not move what is already at the end.
                config.bottomNav &&
                  config.navRegistry &&
                  'pb-24 [scroll-padding-bottom:5rem] md:pb-24 xl:pb-6 xl:[scroll-padding-bottom:0]',
              )}
            >
              <PageErrorBoundary
                labels={{
                  title: tError('somethingWentWrong'),
                  fallbackMessage: tError('errorDescription'),
                  tryAgain: tError('tryAgain'),
                }}
              >
                {children}
              </PageErrorBoundary>
            </main>
          </div>
        </div>
      </div>
      <CommandPalette config={config} open={paletteOpen} onOpenChange={setPaletteOpen} />
    </SidebarProvider>
  );
}

function useAbilityFilteredConfig(config: LayoutConfig): LayoutConfig {
  const ability = useAbility();
  return React.useMemo(() => {
    const navGroups = config.navGroups
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) => !item.ability || ability.can(item.ability.action, item.ability.subject),
        ),
      }))
      .filter((group) => group.items.length > 0);
    const quickActions = config.quickActions?.filter(
      (action) => !action.ability || ability.can(action.ability.action, action.ability.subject),
    );
    return { ...config, navGroups, quickActions };
  }, [config, ability]);
}
