/**
 * The sidebar hides links a role cannot open: AdminLayout drops a nav item whose `ability`
 * the viewer lacks (covered in admin-layout.spec), so every gated page's item must carry one.
 */
import type { LayoutConfig } from '@roviq/ui';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../../../__test-utils__/render-with-providers';

const captured = vi.hoisted(() => ({ config: null as LayoutConfig | null }));

vi.mock('@roviq/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@roviq/ui')>()),
  AdminLayout: ({ config, children }: { config: LayoutConfig; children: React.ReactNode }) => {
    captured.config = config;
    return <>{children}</>;
  },
}));

vi.mock('@roviq/auth', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({
    logout: vi.fn(),
    user: { id: 'user-1', username: 'teacher', tenantId: 'tenant-1', abilityRules: [] },
    memberships: [],
    switchInstitute: vi.fn(),
  }),
}));
vi.mock('@web/components/impersonation/use-impersonation-session', () => ({
  useImpersonationSession: () => ({ active: false }),
}));
vi.mock('../../../../../hooks/use-push-notifications', () => ({ usePushNotifications: vi.fn() }));
vi.mock('../institute-locales-provider', () => ({
  CurrentInstituteLocalesProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../tenant-theme-provider', () => ({
  TenantThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import InstituteDashboard from '../layout';

function sidebarItem(href: string) {
  const items = captured.config?.navGroups.flatMap((group) => group.items) ?? [];
  const item = items.find((entry) => entry.href === href);
  if (!item) throw new Error(`no sidebar item for ${href}`);
  return item;
}

describe('Institute sidebar abilities', () => {
  it.each([
    ['/certificates/tc', 'TC'],
    ['/admission/enquiries', 'Enquiry'],
    ['/admission/applications', 'Application'],
    ['/admission/statistics', 'Enquiry'],
    ['/audit', 'AuditLog'],
    ['/people/students', 'Student'],
    ['/attendance', 'Attendance'],
    ['/attendance/history', 'Attendance'],
  ])('gates %s behind read %s', (href, subject) => {
    renderWithProviders(
      <InstituteDashboard>
        <div />
      </InstituteDashboard>,
    );

    expect(sidebarItem(href).ability).toEqual({ action: 'read', subject });
  });

  it('keeps the pages every member may open ungated', () => {
    renderWithProviders(
      <InstituteDashboard>
        <div />
      </InstituteDashboard>,
    );

    expect(sidebarItem('/dashboard').ability).toBeUndefined();
    expect(sidebarItem('/profile').ability).toBeUndefined();
  });
});
