import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const useResellerMock = vi.fn();
const useUpdateResellerMock = vi.fn(() => [vi.fn(), { loading: false }]);
const useChangeResellerTierMock = vi.fn(() => [vi.fn(), { loading: false }]);
const useSuspendResellerMock = vi.fn(() => [vi.fn(), { loading: false }]);
const useUnsuspendResellerMock = vi.fn(() => [vi.fn(), { loading: false }]);
const useDeleteResellerMock = vi.fn(() => [vi.fn(), { loading: false }]);

vi.mock('../../use-resellers', () => ({
  useReseller: (id: string) => useResellerMock(id),
  useUpdateReseller: () => useUpdateResellerMock(),
  useChangeResellerTier: () => useChangeResellerTierMock(),
  useSuspendReseller: () => useSuspendResellerMock(),
  useUnsuspendReseller: () => useUnsuspendResellerMock(),
  useDeleteReseller: () => useDeleteResellerMock(),
}));

const pushMock = vi.fn();
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return {
    ...actual,
    useParams: () => ({ id: 'reseller-id' }),
    useRouter: () => ({ push: pushMock, back: vi.fn(), replace: vi.fn() }),
  };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('nuqs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nuqs')>();
  return {
    ...actual,
    useQueryState: () => ['overview', vi.fn()],
  };
});

import adminResellersMessages from '../../../../../../../../messages/en/adminResellers.json';
import geographyMessages from '../../../../../../../../messages/en/geography.json';
import { renderWithProviders } from '../../../../../../../__test-utils__/render-with-providers';
import type { ResellerNode } from '../../types';
import ResellerDetailPage from '../page';

const messages = { adminResellers: adminResellersMessages, geography: geographyMessages };

const DAY_MS = 24 * 60 * 60 * 1000;

function makeReseller(overrides: Partial<ResellerNode> = {}): ResellerNode {
  return {
    id: 'reseller-id',
    name: 'Acme Partners',
    slug: 'acme-partners',
    tier: 'FULL_MANAGEMENT',
    status: 'ACTIVE',
    isSystem: false,
    isActive: true,
    customDomain: null,
    suspendedAt: null,
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    instituteCount: 3,
    teamSize: 5,
    version: 1,
    branding: null,
    registrationNumber: null,
    registrationState: null,
    contact: { phones: [], emails: [] },
    address: null,
    ...overrides,
  };
}

function mockReseller(reseller: ResellerNode | null, loading = false) {
  useResellerMock.mockReturnValue({
    data: reseller ? { adminGetReseller: reseller } : undefined,
    loading,
    refetch: vi.fn(),
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ResellerDetailPage', () => {
  beforeEach(() => {
    useResellerMock.mockReset();
    pushMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the loading skeleton while the query is pending', () => {
    mockReseller(null, true);
    renderWithProviders(<ResellerDetailPage />, { messages });
    expect(screen.getByTestId('reseller-detail-loading')).toBeInTheDocument();
  });

  it('renders a not-found message when the reseller id does not resolve', () => {
    mockReseller(null, false);
    renderWithProviders(<ResellerDetailPage />, { messages });
    expect(screen.getByTestId('reseller-not-found')).toBeInTheDocument();
  });

  it('renders header with name, tier, status, and slug for ordinary reseller', () => {
    mockReseller(makeReseller());
    renderWithProviders(<ResellerDetailPage />, { messages });
    expect(screen.getByTestId('reseller-detail-title')).toHaveTextContent('Acme Partners');
    expect(screen.getByTestId('reseller-status-badge')).toHaveTextContent('Active');
    expect(screen.getByTestId('reseller-tier-badge')).toHaveTextContent('Full Management');
    expect(screen.queryByTestId('reseller-system-badge')).not.toBeInTheDocument();
  });

  it('shows the system badge + notice for the Roviq Direct reseller', () => {
    mockReseller(makeReseller({ isSystem: true, name: 'Roviq Direct' }));
    renderWithProviders(<ResellerDetailPage />, { messages });
    expect(screen.getByTestId('reseller-system-badge')).toBeInTheDocument();
    expect(screen.getByTestId('reseller-system-notice')).toBeInTheDocument();
  });

  describe('action gating', () => {
    it('ACTIVE non-system reseller: Edit + ChangeTier + Suspend visible; Unsuspend + Delete hidden', () => {
      mockReseller(makeReseller({ status: 'ACTIVE', isSystem: false }));
      renderWithProviders(<ResellerDetailPage />, { messages });

      expect(screen.getByTestId('action-edit-btn')).toBeInTheDocument();
      expect(screen.getByTestId('action-change-tier-btn')).toBeInTheDocument();
      expect(screen.getByTestId('action-suspend-btn')).toBeInTheDocument();
      expect(screen.queryByTestId('action-unsuspend-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('action-delete-btn')).not.toBeInTheDocument();
    });

    it('SUSPENDED under 30 days: Unsuspend enabled, Delete disabled with the grace-period reason', () => {
      mockReseller(
        makeReseller({
          status: 'SUSPENDED',
          suspendedAt: new Date(Date.now() - 5 * DAY_MS).toISOString(),
        }),
      );
      renderWithProviders(<ResellerDetailPage />, { messages });

      expect(screen.getByTestId('action-unsuspend-btn')).toBeEnabled();
      const del = screen.getByTestId('action-delete-btn');
      expect(del).toBeDisabled();
      expect(del).toHaveAttribute('title', adminResellersMessages.actions.deleteGracePeriod);
      expect(screen.getByTestId('action-change-tier-btn')).toBeDisabled();
      expect(screen.queryByTestId('action-suspend-btn')).not.toBeInTheDocument();
    });

    it('SUSPENDED for 30+ days: Delete is enabled', () => {
      mockReseller(
        makeReseller({
          status: 'SUSPENDED',
          suspendedAt: new Date(Date.now() - 40 * DAY_MS).toISOString(),
        }),
      );
      renderWithProviders(<ResellerDetailPage />, { messages });
      expect(screen.getByTestId('action-delete-btn')).toBeEnabled();
    });

    it('DELETED reseller: Edit disabled; every lifecycle action hidden', () => {
      mockReseller(makeReseller({ status: 'DELETED', isSystem: false }));
      renderWithProviders(<ResellerDetailPage />, { messages });

      expect(screen.getByTestId('action-edit-btn')).toBeDisabled();
      expect(screen.queryByTestId('action-change-tier-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('action-suspend-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('action-unsuspend-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('action-delete-btn')).not.toBeInTheDocument();
    });

    it('system reseller: Edit, ChangeTier, Suspend and Delete shown disabled with the reason', () => {
      mockReseller(makeReseller({ status: 'ACTIVE', isSystem: true, name: 'Roviq Direct' }));
      renderWithProviders(<ResellerDetailPage />, { messages });

      for (const testId of [
        'action-edit-btn',
        'action-change-tier-btn',
        'action-suspend-btn',
        'action-delete-btn',
      ]) {
        const btn = screen.getByTestId(testId);
        expect(btn).toBeDisabled();
        expect(btn).toHaveAttribute('title', adminResellersMessages.detail.systemLocked);
      }
      expect(screen.queryByTestId('action-unsuspend-btn')).not.toBeInTheDocument();
    });
  });

  it('renders all five tab triggers', () => {
    mockReseller(makeReseller());
    renderWithProviders(<ResellerDetailPage />, { messages });

    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
    expect(screen.getByTestId('tab-institutes')).toBeInTheDocument();
    expect(screen.getByTestId('tab-team')).toBeInTheDocument();
    expect(screen.getByTestId('tab-activity')).toBeInTheDocument();
    expect(screen.getByTestId('tab-billing')).toBeInTheDocument();
  });

  it('renders institute count and team size in the stats card', () => {
    mockReseller(makeReseller({ instituteCount: 42, teamSize: 11 }));
    renderWithProviders(<ResellerDetailPage />, { messages });
    expect(screen.getByTestId('detail-institute-count')).toHaveTextContent('42');
    expect(screen.getByTestId('detail-team-size')).toHaveTextContent('11');
  });

  it('renders registration, primary contact and address in the business card', () => {
    mockReseller(
      makeReseller({
        registrationNumber: 'U72900RJ2024PTC012345',
        registrationState: 'RAJASTHAN',
        contact: {
          phones: [
            {
              countryCode: '+91',
              number: '9876543210',
              isPrimary: true,
              isWhatsappEnabled: false,
              label: 'Office',
            },
          ],
          emails: [
            { address: 'ops@other.test', isPrimary: false, label: 'Ops' },
            { address: 'hello@acme.test', isPrimary: true, label: 'Main' },
          ],
        },
        address: {
          line1: '12 MI Road',
          line2: null,
          line3: null,
          city: 'Jaipur',
          district: 'Jaipur',
          state: 'RAJASTHAN',
          postalCode: '302001',
          country: 'IN',
        },
      }),
    );
    renderWithProviders(<ResellerDetailPage />, { messages });

    expect(screen.getByTestId('detail-registration-number')).toHaveTextContent(
      'U72900RJ2024PTC012345',
    );
    expect(screen.getByTestId('detail-registration-state')).toHaveTextContent('Rajasthan');
    expect(screen.getByTestId('detail-contact-email')).toHaveTextContent('hello@acme.test');
    expect(screen.getByTestId('detail-contact-phone')).toHaveTextContent('+91 9876543210');
    expect(screen.getByTestId('detail-address')).toHaveTextContent(
      '12 MI Road, Jaipur, Jaipur, Rajasthan, 302001',
    );
  });

  it('shows dashes when no business details are on file', () => {
    mockReseller(makeReseller());
    renderWithProviders(<ResellerDetailPage />, { messages });
    expect(screen.getByTestId('detail-registration-number')).toHaveTextContent('—');
    expect(screen.getByTestId('detail-contact-email')).toHaveTextContent('—');
    expect(screen.getByTestId('detail-address')).toHaveTextContent('—');
  });
});
