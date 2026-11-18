import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { describe, expect, it } from 'vitest';
import { ResellerInstitutesTab } from '../institutes-tab';
import { AdminResellerInstitutesDocument } from '../institutes-tab.generated';

const RESELLER_ID = 'reseller-1';

function institutesMock(nodes: Record<string, unknown>[], totalCount = nodes.length) {
  return {
    request: {
      query: AdminResellerInstitutesDocument,
      variables: { resellerId: RESELLER_ID, first: 20 },
    },
    result: {
      data: {
        adminListInstitutes: {
          __typename: 'InstituteConnection',
          totalCount,
          pageInfo: {
            __typename: 'PageInfo',
            hasNextPage: totalCount > nodes.length,
            endCursor: 'c1',
          },
          edges: nodes.map((node) => ({ __typename: 'InstituteEdge', node })),
        },
      },
    },
  };
}

const institute = {
  __typename: 'InstituteModel',
  id: 'inst-1',
  name: { en: 'Saraswati Vidya Mandir' },
  code: 'SVM-01',
  status: 'ACTIVE',
  createdAt: '2026-03-05T00:00:00.000Z',
};

describe('ResellerInstitutesTab', () => {
  it('lists institutes with a link, status and a count of what is shown', async () => {
    renderWithProviders(<ResellerInstitutesTab resellerId={RESELLER_ID} />, {
      apolloMocks: [institutesMock([institute], 3)],
    });

    const row = await screen.findByTestId('reseller-institute-row-inst-1');
    expect(within(row).getByRole('link', { name: /Saraswati Vidya Mandir/ })).toHaveAttribute(
      'href',
      '/admin/institutes/inst-1',
    );
    expect(row).toHaveTextContent('SVM-01');
    expect(row).toHaveTextContent('Active');
    expect(row).toHaveTextContent('05/03/2026');
    expect(screen.getByText('Showing 1 of 3')).toBeInTheDocument();
    expect(screen.getByTestId('reseller-institutes-load-more-btn')).toBeInTheDocument();
  });

  it('opens the reassign dialog named after the institute', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ResellerInstitutesTab resellerId={RESELLER_ID} />, {
      apolloMocks: [institutesMock([institute])],
    });

    await user.click(await screen.findByTestId('reseller-institute-reassign-btn-inst-1'));

    expect(screen.getByTestId('reassign-institute-dialog-title')).toHaveTextContent(
      'Reassign Saraswati Vidya Mandir',
    );
    expect(screen.getByTestId('reassign-institute-confirm-btn')).toBeDisabled();
  });

  it('hides the reassign action without update:Institute', async () => {
    renderWithProviders(<ResellerInstitutesTab resellerId={RESELLER_ID} />, {
      apolloMocks: [institutesMock([institute])],
      abilityRules: [{ action: 'read', subject: 'all' }],
    });
    await screen.findByTestId('reseller-institute-row-inst-1');
    expect(screen.queryByTestId('reseller-institute-reassign-btn-inst-1')).not.toBeInTheDocument();
  });

  it('shows the empty state when no institute is assigned', async () => {
    renderWithProviders(<ResellerInstitutesTab resellerId={RESELLER_ID} />, {
      apolloMocks: [institutesMock([])],
    });
    expect(await screen.findByTestId('reseller-institutes-empty')).toBeInTheDocument();
  });
});
