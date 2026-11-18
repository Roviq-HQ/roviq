import '@testing-library/jest-dom/vitest';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useUsersMock = vi.fn();
let urlFilters: Record<string, unknown> = {};

vi.mock('../use-users', () => ({
  PAGE_SIZE: 20,
  useUsers: (filter: unknown) => useUsersMock(filter),
  useUserSearch: () => ({ data: undefined, loading: false }),
  useUserStatistics: () => ({
    data: {
      adminUserStatistics: {
        totalUsers: 1250,
        activeThisMonth: 300,
        newThisWeek: 12,
        multiInstituteUsers: 4,
      },
    },
    loading: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual, useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }) };
});

vi.mock('nuqs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nuqs')>();
  return { ...actual, useQueryStates: () => [urlFilters, vi.fn()] };
});

import adminUsersMessages from '../../../../../../../messages/en/adminUsers.json';
import { renderWithProviders } from '../../../../../../__test-utils__/render-with-providers';
import UsersPage from '../page';
import type { UserListNode } from '../types';

const { adminUsers } = testIds;
const messages = { adminUsers: adminUsersMessages };

const EMPTY_FILTERS = {
  search: null,
  status: null,
  institute: null,
  reseller: null,
  platform: null,
  createdAfter: null,
  createdBefore: null,
};

function makeUser(overrides: Partial<UserListNode> = {}): UserListNode {
  return {
    __typename: 'AdminUserModel',
    id: 'user-1',
    username: 'priya.sharma',
    email: 'priya@example.test',
    status: 'ACTIVE',
    createdAt: '2026-01-10T00:00:00.000Z',
    lastActiveAt: null,
    primaryPhone: { __typename: 'AdminUserPhoneModel', countryCode: '91', number: '9876543210' },
    profile: {
      __typename: 'AdminUserProfileModel',
      firstName: { en: 'Priya' },
      lastName: { en: 'Sharma' },
      profileImageUrl: null,
    },
    memberships: [
      { __typename: 'AdminUserMembershipModel', id: 'm-1' },
      { __typename: 'AdminUserMembershipModel', id: 'm-2' },
    ],
    ...overrides,
  };
}

function mockUsers(users: UserListNode[]) {
  useUsersMock.mockReturnValue({
    users,
    totalCount: users.length,
    hasNextPage: false,
    loading: false,
    error: undefined,
    loadMore: vi.fn(),
    refetch: vi.fn(),
  });
}

describe('UsersPage', () => {
  beforeEach(() => {
    urlFilters = { ...EMPTY_FILTERS };
    useUsersMock.mockReset();
  });

  it('should list users with name, phone and institute count, and show the stats', () => {
    mockUsers([makeUser()]);

    renderWithProviders(<UsersPage />, { messages });

    expect(screen.getByTestId(adminUsers.nameCell('user-1'))).toHaveTextContent('Priya Sharma');
    expect(screen.getByText('+91 9876543210')).toBeInTheDocument();
    expect(screen.getByTestId(adminUsers.membershipCount('user-1'))).toHaveTextContent(
      '2 institutes',
    );
    expect(screen.getByTestId(adminUsers.stat('total'))).toHaveTextContent('1,250');
    expect(useUsersMock).toHaveBeenCalledWith({});
  });

  it('should turn URL filters into the GraphQL filter, with an inclusive end date', () => {
    urlFilters = {
      ...EMPTY_FILTERS,
      search: 'priya',
      status: 'LOCKED',
      institute: true,
      platform: true,
      createdAfter: new Date('2026-01-01T00:00:00.000Z'),
      createdBefore: new Date('2026-01-31T00:00:00.000Z'),
    };
    mockUsers([]);

    renderWithProviders(<UsersPage />, { messages });

    expect(useUsersMock).toHaveBeenCalledWith({
      search: 'priya',
      status: ['LOCKED'],
      hasInstituteMembership: true,
      hasPlatformMembership: true,
      createdAfter: '2026-01-01T00:00:00.000Z',
      createdBefore: '2026-01-31T23:59:59.999Z',
    });
    expect(screen.getByTestId(adminUsers.emptyFilteredTitle)).toBeInTheDocument();
  });

  it('should ignore an unknown status in the URL', () => {
    urlFilters = { ...EMPTY_FILTERS, status: 'DELETED' };
    mockUsers([]);

    renderWithProviders(<UsersPage />, { messages });

    expect(useUsersMock).toHaveBeenCalledWith({});
    expect(screen.getByTestId(adminUsers.emptyTitle)).toBeInTheDocument();
  });
});
