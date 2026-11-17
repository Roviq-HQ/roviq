/**
 * Regression — select-institute must honour the post-login returnUrl.
 *
 * Bug: a multi-institute user bounced from a protected page to /login was sent
 * to /select-institute without the returnUrl, and selection hardcoded /dashboard,
 * so they never returned to the page they originally requested.
 */
import { AuthRequestError } from '@roviq/auth';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
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
vi.mock('@roviq/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@roviq/auth')>()),
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
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

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

describe('SelectInstitutePage — selection failures', () => {
  beforeEach(() => {
    replace.mockClear();
    selectInstitute.mockReset();
    vi.mocked(toast.error).mockClear();
    setUrl('');
  });

  it('sends the user back to login with a toast when the selection token has expired', async () => {
    selectInstitute.mockRejectedValueOnce(
      new AuthRequestError('Invalid or expired selection token', 'SESSION_EXPIRED'),
    );
    renderWithProviders(<SelectInstitutePage />);

    await userEvent.click(screen.getByTestId('select-institute-option-m1'));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(toast.error).toHaveBeenCalledWith('Your session has expired. Please sign in again.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains a revoked membership inline and keeps the user on the page', async () => {
    selectInstitute.mockRejectedValueOnce(
      new AuthRequestError('No active membership found', 'NO_ACTIVE_MEMBERSHIP'),
    );
    renderWithProviders(<SelectInstitutePage />);

    await userEvent.click(screen.getByTestId('select-institute-option-m1'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You no longer have access to this institute.',
    );
    expect(replace).not.toHaveBeenCalledWith('/login');
  });
});
