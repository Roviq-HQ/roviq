import '@testing-library/jest-dom/vitest';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useAdminUserMock = vi.fn();
let activeTab = 'memberships';

vi.mock('../../use-users', () => ({
  useAdminUser: (id: string) => useAdminUserMock(id),
}));

vi.mock('../_components/audit-tab', () => ({
  UserAuditTab: () => null,
}));

const signedIn = vi.hoisted(() => ({ id: 'platform-admin-1' }));
vi.mock('@roviq/auth', () => ({ useAuth: () => ({ user: { id: signedIn.id } }) }));

vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return {
    ...actual,
    useParams: () => ({ id: 'user-1' }),
    useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  };
});

vi.mock('nuqs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nuqs')>();
  return { ...actual, useQueryState: () => [activeTab, vi.fn()] };
});

import adminUsersMessages from '../../../../../../../../messages/en/adminUsers.json';
import { renderWithProviders } from '../../../../../../../__test-utils__/render-with-providers';
import type { UserDetail } from '../../types';
import UserDetailPage from '../page';

const { adminUserDetail } = testIds;
const messages = { adminUsers: adminUsersMessages };

function makeUser(overrides: Partial<UserDetail> = {}): UserDetail {
  return {
    __typename: 'AdminUserDetailModel',
    id: 'user-1',
    username: 'priya.sharma',
    email: 'priya@example.test',
    status: 'ACTIVE',
    createdAt: '2026-01-10T00:00:00.000Z',
    lastActiveAt: null,
    primaryPhone: { __typename: 'AdminUserPhoneModel', countryCode: '+91', number: '9876543210' },
    profile: {
      __typename: 'AdminUserDetailProfileModel',
      firstName: { en: 'Priya' },
      lastName: { en: 'Sharma' },
      profileImage: null,
      gender: 'FEMALE',
      dateOfBirth: '1990-04-15',
      nationality: 'Indian',
    },
    memberships: [
      {
        __typename: 'AdminUserMembershipModel',
        id: 'm-1',
        tenantId: 'inst-1',
        roleName: { en: 'Principal' },
        status: 'ACTIVE',
        instituteName: { en: 'Saraswati Vidya Mandir' },
        joinedAt: '2026-02-01T00:00:00.000Z',
      },
    ],
    resellerMemberships: [],
    platformMembership: null,
    identifiers: [
      {
        __typename: 'AdminUserIdentifierModel',
        id: 'id-1',
        type: 'AADHAAR',
        displayValue: 'XXXX XXXX 4321',
        isVerified: true,
        issuingAuthority: 'UIDAI',
      },
    ],
    documents: [],
    addresses: [],
    ...overrides,
  };
}

function mockUser(user: UserDetail | null, extra: { loading?: boolean; error?: unknown } = {}) {
  useAdminUserMock.mockReturnValue({
    data: user ? { adminGetUser: user } : undefined,
    loading: extra.loading ?? false,
    error: extra.error,
    refetch: vi.fn(),
  });
}

describe('UserDetailPage', () => {
  beforeEach(() => {
    activeTab = 'memberships';
    useAdminUserMock.mockReset();
  });

  it('should show the profile card and the institute membership with a link to the institute', () => {
    mockUser(makeUser());

    renderWithProviders(<UserDetailPage />, { messages });

    expect(screen.getByTestId(adminUserDetail.name)).toHaveTextContent('Priya Sharma');
    expect(screen.getByTestId(adminUserDetail.username)).toHaveTextContent('priya.sharma');
    expect(screen.getByText('+91 9876543210')).toBeInTheDocument();
    const row = screen.getByTestId(adminUserDetail.membershipRow('m-1'));
    expect(within(row).getByText('Saraswati Vidya Mandir')).toBeInTheDocument();
    expect(within(row).getByText('Principal')).toBeInTheDocument();
    expect(screen.getByTestId(adminUserDetail.viewInstituteBtn('m-1'))).toHaveAttribute(
      'href',
      '/admin/institutes/inst-1',
    );
  });

  describe('View as on an institute membership (ROV-183)', () => {
    const viewAs = () => screen.queryByTestId(adminUserDetail.impersonateBtn('m-1'));

    beforeEach(() => {
      signedIn.id = 'platform-admin-1';
    });

    it('opens the reason dialog naming the user and the institute', async () => {
      mockUser(makeUser());
      renderWithProviders(<UserDetailPage />);

      const button = viewAs();
      expect(button).toHaveAttribute('title', 'Open a new tab signed in as this user');
      await userEvent.click(button as HTMLElement);

      const dialog = await screen.findByTestId(testIds.impersonation.dialog);
      expect(dialog).toHaveTextContent('View as Priya Sharma');
      expect(dialog).toHaveTextContent('Saraswati Vidya Mandir');
    });

    it('is not offered for a membership that is not active', () => {
      const user = makeUser();
      mockUser(makeUser({ memberships: [{ ...user.memberships[0], status: 'SUSPENDED' }] }));
      renderWithProviders(<UserDetailPage />);

      expect(screen.getByTestId(adminUserDetail.membershipRow('m-1'))).toBeInTheDocument();
      expect(viewAs()).not.toBeInTheDocument();
    });

    it('is not offered for a user who is not active', () => {
      mockUser(makeUser({ status: 'SUSPENDED' }));
      renderWithProviders(<UserDetailPage />);

      expect(viewAs()).not.toBeInTheDocument();
    });

    it('is not offered to a platform role without the impersonate ability', () => {
      mockUser(makeUser());
      renderWithProviders(<UserDetailPage />, {
        abilityRules: [{ action: 'read', subject: 'all' }],
      });

      expect(viewAs()).not.toBeInTheDocument();
    });

    it('is not offered on your own account', () => {
      signedIn.id = 'user-1';
      mockUser(makeUser());
      renderWithProviders(<UserDetailPage />);

      expect(viewAs()).not.toBeInTheDocument();
    });
  });

  it('should show Aadhaar only as the masked value the API returns', () => {
    activeTab = 'identity';
    mockUser(makeUser());

    renderWithProviders(<UserDetailPage />, { messages });

    expect(screen.getByTestId(adminUserDetail.identifierValue('id-1'))).toHaveTextContent(
      'XXXX XXXX 4321',
    );
  });

  it('should show an empty state when the user has no memberships', () => {
    mockUser(makeUser({ memberships: [] }));

    renderWithProviders(<UserDetailPage />, { messages });

    expect(screen.getByTestId(adminUserDetail.empty('memberships'))).toBeInTheDocument();
  });

  it('should show not-found when the API answers NOT_FOUND', () => {
    mockUser(null, {
      error: new CombinedGraphQLErrors({
        errors: [{ message: 'User not found', extensions: { code: 'NOT_FOUND' } }],
      }),
    });

    renderWithProviders(<UserDetailPage />, { messages });

    expect(screen.getByTestId(adminUserDetail.notFound)).toHaveTextContent('User not found');
  });

  it('should offer a retry when loading fails for another reason', () => {
    mockUser(null, { error: new Error('network down') });

    renderWithProviders(<UserDetailPage />, { messages });

    expect(screen.getByTestId(adminUserDetail.loadError)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
