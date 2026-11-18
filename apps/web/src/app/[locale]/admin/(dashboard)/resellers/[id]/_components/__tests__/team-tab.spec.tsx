import { screen } from '@testing-library/react';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { describe, expect, it } from 'vitest';
import { ResellerTeamTab } from '../team-tab';
import { AdminResellerTeamDocument } from '../team-tab.generated';

const RESELLER_ID = 'reseller-1';

function teamMock(members: Record<string, unknown>[]) {
  return {
    request: { query: AdminResellerTeamDocument, variables: { resellerId: RESELLER_ID } },
    result: { data: { adminListResellerTeam: members } },
  };
}

const member = {
  __typename: 'AdminResellerTeamMemberModel',
  id: 'membership-1',
  userId: 'user-1',
  username: 'priya.admin',
  email: 'priya@acme.test',
  firstName: { en: 'Priya' },
  lastName: { en: 'Verma' },
  roleName: { en: 'reseller_full_admin' },
  isActive: true,
  joinedAt: '2026-02-01T00:00:00.000Z',
  lastActiveAt: null,
};

describe('ResellerTeamTab', () => {
  it('lists each member with name, readable role, status and a never-signed-in marker', async () => {
    renderWithProviders(<ResellerTeamTab resellerId={RESELLER_ID} />, {
      apolloMocks: [teamMock([member])],
    });

    const row = await screen.findByTestId('reseller-team-row-membership-1');
    expect(row).toHaveTextContent('Priya Verma');
    expect(row).toHaveTextContent('priya@acme.test');
    expect(row).toHaveTextContent('Reseller admin');
    expect(row).toHaveTextContent('Active');
    expect(row).toHaveTextContent('Never signed in');
    expect(row).toHaveTextContent('01/02/2026');
    expect(screen.getByRole('link', { name: 'Priya Verma' })).toHaveAttribute(
      'href',
      '/admin/users/user-1',
    );
  });

  it('falls back to the Roviq ID when the member has no profile name', async () => {
    renderWithProviders(<ResellerTeamTab resellerId={RESELLER_ID} />, {
      apolloMocks: [teamMock([{ ...member, firstName: null, lastName: null }])],
    });
    expect(await screen.findByRole('link', { name: 'priya.admin' })).toBeInTheDocument();
  });

  it('shows the empty state when the reseller has no staff', async () => {
    renderWithProviders(<ResellerTeamTab resellerId={RESELLER_ID} />, {
      apolloMocks: [teamMock([])],
    });
    expect(await screen.findByTestId('reseller-team-empty')).toBeInTheDocument();
  });
});
