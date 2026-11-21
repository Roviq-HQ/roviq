import '@testing-library/jest-dom/vitest';
import type { InstituteStatus, SetupStatus } from '@roviq/common-types';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const instituteState = vi.hoisted(() => ({
  status: 'PENDING' as string,
  setupStatus: 'COMPLETED' as string,
}));

const mutation = vi.hoisted(() => [vi.fn(), { loading: false }] as const);

vi.mock('../../use-institutes', () => ({
  useInstitute: () => ({
    data: {
      adminGetInstitute: {
        id: 'inst-1',
        name: { en: 'Sunrise Academy' },
        code: 'SUN-01',
        type: 'SCHOOL',
        status: instituteState.status,
        setupStatus: instituteState.setupStatus,
        structureFramework: 'TRADITIONAL',
        timezone: 'Asia/Kolkata',
        currency: 'INR',
        groupId: null,
        firstAdmin: {
          firstName: 'Meera',
          lastName: 'Joshi',
          email: 'meera@sunrise.example',
          phone: '9812345678',
          detailsWithheld: false,
        },
        contact: { phones: [], emails: [] },
        address: null,
        identifiers: [],
        affiliations: [
          {
            id: 'aff-1',
            board: 'CBSE',
            affiliationStatus: 'PROVISIONAL',
            affiliationNumber: null,
            grantedLevel: null,
            validFrom: null,
            validTo: null,
            nocNumber: null,
            nocDate: null,
          },
        ],
        config: null,
        branding: null,
      },
    },
    loading: false,
    refetch: vi.fn(),
  }),
  useApproveInstitute: () => mutation,
  useActivateInstitute: () => mutation,
  useDeactivateInstitute: () => mutation,
  useSuspendInstitute: () => mutation,
  useRejectInstitute: () => mutation,
  useDeleteInstitute: () => mutation,
  useReassignReseller: () => mutation,
  useAssignGroup: () => mutation,
  useRemoveGroup: () => mutation,
}));

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useParams: () => ({ id: 'inst-1' }),
}));

vi.mock('nuqs', () => ({
  parseAsString: { withDefault: () => ({}) },
  useQueryState: () => ['overview', vi.fn()],
}));

import { renderWithProviders } from '../../../../../../../__test-utils__/render-with-providers';
import InstituteDetailPage from '../page';

function renderFor(status: InstituteStatus, setupStatus: SetupStatus) {
  instituteState.status = status;
  instituteState.setupStatus = setupStatus;
  renderWithProviders(<InstituteDetailPage />);
}

const activateButton = () => screen.queryByTestId(testIds.adminInstituteDetail.actionActivate);

describe('InstituteDetailPage — Activate', () => {
  it.each([
    'PENDING',
    'INACTIVE',
    'SUSPENDED',
  ] as const)('offers Activate for a %s institute whose setup is complete', (status) => {
    renderFor(status, 'COMPLETED');
    expect(activateButton()).toBeEnabled();
  });

  it('shows Activate disabled while an approved institute is still being set up', () => {
    renderFor('PENDING', 'IN_PROGRESS');
    expect(activateButton()).toBeDisabled();
  });

  it.each([
    'PENDING_APPROVAL',
    'ACTIVE',
    'REJECTED',
  ] as const)('does not offer Activate for a %s institute', (status) => {
    renderFor(status, 'COMPLETED');
    expect(activateButton()).not.toBeInTheDocument();
  });
});

describe('InstituteDetailPage — Reject and Restore', () => {
  const rejectButton = () => screen.queryByRole('button', { name: 'Reject' });

  it.each([
    'PENDING_APPROVAL',
    'PENDING',
  ] as const)('offers Reject for a %s institute, as the state machine allows', (status) => {
    renderFor(status, 'COMPLETED');
    expect(rejectButton()).toBeInTheDocument();
  });

  it.each([
    'ACTIVE',
    'INACTIVE',
    'SUSPENDED',
    'REJECTED',
  ] as const)('does not offer Reject for a %s institute', (status) => {
    renderFor(status, 'COMPLETED');
    expect(rejectButton()).not.toBeInTheDocument();
  });

  it.each([
    'REJECTED',
    'INACTIVE',
  ] as const)('does not offer Restore for a %s institute that is not deleted', (status) => {
    renderFor(status, 'COMPLETED');
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
  });
});

describe('InstituteDetailPage — first admin', () => {
  it('shows who receives the admin login on the Overview', () => {
    renderFor('PENDING', 'COMPLETED');
    const card = screen.getByTestId(testIds.adminInstituteDetail.firstAdminCard);
    expect(within(card).getByText('Meera Joshi')).toBeInTheDocument();
    expect(within(card).getByText('meera@sunrise.example')).toBeInTheDocument();
    expect(within(card).getByText('+91 9812345678')).toBeInTheDocument();
  });
});

describe('InstituteDetailPage — labels', () => {
  it('shows the structure framework and affiliation status as labels, not enum values', () => {
    renderFor('ACTIVE', 'COMPLETED');

    expect(screen.getByText('Traditional (10+2)')).toBeInTheDocument();
    expect(screen.queryByText('TRADITIONAL')).not.toBeInTheDocument();
    expect(screen.getByText('Provisional')).toBeInTheDocument();
    expect(screen.queryByText('PROVISIONAL')).not.toBeInTheDocument();
  });
});
