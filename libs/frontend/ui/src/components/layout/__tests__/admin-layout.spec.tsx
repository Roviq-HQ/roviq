import '@testing-library/jest-dom/vitest';
import { createMongoAbility, type RawRuleOf } from '@casl/ability';
import type { AppAbility } from '@roviq/common-types';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Home } from 'lucide-react';
import type * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ── Mocks (hoisted by vitest above static imports) ─────────────────────────
// next/navigation is exercised by Topbar, Sidebar, Breadcrumbs and the
// BottomTabBar. Stub the hooks so the module renders without a real router.
vi.mock('next/navigation', () => ({
  usePathname: () => '/en/dashboard',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// next-intl provides locale + translations to multiple layout children.
vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => Object.assign((key: string) => key, { has: () => false }),
}));

// next-themes' real ThemeProvider relies on `localStorage` and `matchMedia`.
// Stub to a passthrough.
vi.mock('next-themes', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTheme: () => ({ theme: 'light', setTheme: vi.fn(), resolvedTheme: 'light' }),
}));

// next/image
vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
}));

// next/link → plain anchor.
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { AbilityContext } from '../../auth/ability-provider';
import { AdminLayout } from '../admin-layout';
import { PINS_KEY } from '../sidebar-pins';
import type { LayoutConfig, NavRegistryEntry } from '../types';

// ── Fixtures ───────────────────────────────────────────────────────────────
const baseConfig: LayoutConfig = {
  appName: 'Roviq',
  onLocaleChange: vi.fn(),
  navGroups: [
    {
      title: 'Main',
      items: [{ title: 'Dashboard', href: '/dashboard', icon: Home }],
    },
  ],
};

const navRegistry: Record<string, NavRegistryEntry> = {
  dashboard: { href: '/dashboard', icon: Home, label: 'Dashboard' },
  students: { href: '/students', icon: Home, label: 'Students' },
};

// ── Tests ──────────────────────────────────────────────────────────────────
describe('AdminLayout', () => {
  it('renders BottomTabBar when bottomNav + navRegistry are configured', () => {
    const config: LayoutConfig = {
      ...baseConfig,
      navRegistry,
      bottomNav: {
        slugs: ['dashboard', 'students'],
        defaultSlugs: [],
        moreLabel: 'More',
      },
    };

    render(
      <AdminLayout config={config}>
        <div>page-content</div>
      </AdminLayout>,
    );

    expect(screen.getByTestId('bottom-tab-bar')).toBeInTheDocument();
    expect(screen.getByText('page-content')).toBeInTheDocument();
  });

  it('renders the skip-to-main link and main has matching id + tabIndex', () => {
    render(
      <AdminLayout config={baseConfig}>
        <div>page-content</div>
      </AdminLayout>,
    );

    const skipLink = screen.getByRole('link', { name: /skip to main/i });
    expect(skipLink).toBeInTheDocument();
    expect(skipLink).toHaveAttribute('href', '#main-content');

    // Use the role to avoid landmark ambiguity; verify id + tabIndex.
    const main = document.querySelector('main#main-content');
    expect(main).not.toBeNull();
    expect(main).toHaveAttribute('tabIndex', '-1');
  });

  it('does NOT render BottomTabBar when bottomNav is omitted', () => {
    render(
      <AdminLayout config={baseConfig}>
        <div>page-content</div>
      </AdminLayout>,
    );

    expect(screen.queryByTestId('bottom-tab-bar')).not.toBeInTheDocument();
    expect(screen.getByText('page-content')).toBeInTheDocument();
  });

  it('renders the app-supplied notification bell inside the topbar', () => {
    render(
      <AdminLayout config={{ ...baseConfig, notificationBell: <span>bell-slot</span> }}>
        <div>page-content</div>
      </AdminLayout>,
    );

    expect(within(screen.getByTestId('topbar')).getByText('bell-slot')).toBeInTheDocument();
  });

  describe('nav item abilities', () => {
    const gatedConfig: LayoutConfig = {
      appName: 'Roviq',
      navGroups: [
        {
          title: 'Main',
          items: [{ title: 'Dashboard', href: '/dashboard', icon: Home }],
        },
        {
          title: 'System',
          items: [
            {
              title: 'Monitoring',
              href: '/monitoring',
              icon: Home,
              ability: { action: 'read', subject: 'SystemHealth' },
            },
          ],
        },
      ],
    };

    function renderWithRules(rules: RawRuleOf<AppAbility>[]) {
      const ability = createMongoAbility<AppAbility>(rules);
      return render(
        <AbilityContext.Provider value={ability}>
          <AdminLayout config={gatedConfig}>
            <div>page-content</div>
          </AdminLayout>
        </AbilityContext.Provider>,
      );
    }

    it('shows a gated item when the viewer has its ability', () => {
      renderWithRules([{ action: 'read', subject: 'SystemHealth' }]);

      expect(screen.getAllByRole('link', { name: 'Monitoring' }).length).toBeGreaterThan(0);
      expect(screen.getAllByRole('link', { name: 'Dashboard' }).length).toBeGreaterThan(0);
    });

    it('hides a gated item and its emptied group when the viewer lacks the ability', () => {
      renderWithRules([{ action: 'read', subject: 'Institute' }]);

      expect(screen.queryByRole('link', { name: 'Monitoring' })).not.toBeInTheDocument();
      expect(screen.queryByText('System')).not.toBeInTheDocument();
      expect(screen.getAllByRole('link', { name: 'Dashboard' }).length).toBeGreaterThan(0);
    });
  });

  describe('quick actions', () => {
    const openSettings = vi.fn();
    const quickConfig: LayoutConfig = {
      ...baseConfig,
      navGroups: [
        {
          title: 'Main',
          items: [
            { title: 'Dashboard', href: '/dashboard', icon: Home },
            { title: 'Attendance', href: '/attendance', icon: Home },
          ],
        },
      ],
      quickActions: [
        { id: 'display-settings', title: 'Display settings', onSelect: openSettings },
        { id: 'attendance', title: 'Take attendance', href: '/attendance' },
        {
          id: 'add-student',
          title: 'Add student',
          href: '/people/students/new',
          ability: { action: 'create', subject: 'Student' },
        },
      ],
    };

    afterEach(() => {
      window.localStorage.removeItem(PINS_KEY);
      openSettings.mockReset();
    });

    function renderQuick(rules: RawRuleOf<AppAbility>[]) {
      const ability = createMongoAbility<AppAbility>(rules);
      return render(
        <AbilityContext.Provider value={ability}>
          <AdminLayout config={quickConfig}>
            <div>page-content</div>
          </AdminLayout>
        </AbilityContext.Provider>,
      );
    }

    it('opens from the top-bar button and hides an action the role cannot use', async () => {
      renderQuick([{ action: 'read', subject: 'Attendance' }]);
      await userEvent.click(screen.getByTestId('quick-actions-button'));

      const palette = await screen.findByTestId('command-palette');
      expect(within(palette).getByTestId('quick-action-display-settings')).toBeInTheDocument();
      expect(within(palette).getByTestId('quick-action-attendance')).toBeInTheDocument();
      expect(within(palette).queryByTestId('quick-action-add-student')).not.toBeInTheDocument();
    });

    it('shows the action when the role has its ability', async () => {
      renderQuick([{ action: 'create', subject: 'Student' }]);
      await userEvent.click(screen.getByTestId('quick-actions-button'));
      expect(await screen.findByTestId('quick-action-add-student')).toBeInTheDocument();
    });

    it('lists a pinned page once, and not when a quick action already goes there', async () => {
      renderQuick([]);
      // Pins are read once per module; another tab's write reaches subscribers by the storage event.
      window.localStorage.setItem(PINS_KEY, JSON.stringify(['/dashboard', '/attendance']));
      act(() => window.dispatchEvent(new StorageEvent('storage', { key: PINS_KEY })));
      await userEvent.click(screen.getByTestId('quick-actions-button'));

      const palette = await screen.findByTestId('command-palette');
      const pinned = within(palette).getByRole('group', { name: 'pinned' });
      expect(within(pinned).getByText('Dashboard')).toBeInTheDocument();
      expect(within(pinned).queryByText('Attendance')).not.toBeInTheDocument();
    });

    it('runs an action and closes the palette', async () => {
      renderQuick([]);
      await userEvent.click(screen.getByTestId('quick-actions-button'));
      await userEvent.click(await screen.findByTestId('quick-action-display-settings'));

      expect(openSettings).toHaveBeenCalledOnce();
      expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();
    });
  });
});
