/**
 * Regression — select-institute must honour the post-login returnUrl.
 *
 * Bug: a multi-institute user bounced from a protected page to /login was sent
 * to /select-institute without the returnUrl, and selection hardcoded /dashboard,
 * so they never returned to the page they originally requested.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../../../__test-utils__/render-with-providers';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/en/institute/select-institute',
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
  notFound: vi.fn(),
  RedirectType: { push: 'push', replace: 'replace' },
}));

const selectInstitute = vi.fn().mockResolvedValue(undefined);
vi.mock('@roviq/auth', () => ({
  // Faithful to the real helper: same-origin relative paths only.
  sanitizeReturnUrl: (raw: string | null | undefined) => {
    if (!raw?.startsWith('/')) return null;
    const second = raw[1];
    if (second === '/' || second === '\\') return null;
    return raw;
  },
  useAuth: () => ({
    memberships: [
      {
        membershipId: 'm1',
        instituteName: { en: 'Greenfield Institute' },
        roleName: { en: 'Admin' },
        instituteLogoUrl: null,
      },
    ],
    needsInstituteSelection: true,
    isAuthenticated: false,
    isLoading: false,
    selectInstitute,
  }),
}));

import SelectInstitutePage from '../page';

function setUrl(search: string) {
  window.history.replaceState({}, '', `/en/institute/select-institute${search}`);
}

describe('SelectInstitutePage — returnUrl redirect', () => {
  beforeEach(() => {
    replace.mockClear();
    selectInstitute.mockClear();
  });

  it('returns to the returnUrl after selecting an institute', async () => {
    setUrl('?returnUrl=%2Fen%2Finstitute%2Fpeople%2Fstudents%2F123');
    renderWithProviders(<SelectInstitutePage />);

    await userEvent.click(screen.getByTestId('select-institute-option-m1'));

    expect(selectInstitute).toHaveBeenCalledWith('m1');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/en/institute/people/students/123'));
  });

  it('falls back to /dashboard when no returnUrl is present', async () => {
    setUrl('');
    renderWithProviders(<SelectInstitutePage />);

    await userEvent.click(screen.getByTestId('select-institute-option-m1'));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
  });
});
