'use client';

import { ThemeProvider } from 'next-themes';
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
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
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
                <Topbar config={config} />
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
                  // Content scrolls all the way under the fixed bottom-tab bar
                  // so the bar's translucent backdrop-blur picks up the page
                  // content beneath it (matches iOS App Store behaviour). The
                  // last item is kept reachable via scroll-padding so the
                  // browser snaps it above the bar when scrolled into view.
                  config.bottomNav &&
                    config.navRegistry &&
                    '[scroll-padding-bottom:5rem] xl:[scroll-padding-bottom:0]',
                )}
              >
                <PageErrorBoundary>{children}</PageErrorBoundary>
              </main>
            </div>
          </div>
        </div>
        <CommandPalette config={config} />
      </SidebarProvider>
    </ThemeProvider>
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
    return { ...config, navGroups };
  }, [config, ability]);
}
