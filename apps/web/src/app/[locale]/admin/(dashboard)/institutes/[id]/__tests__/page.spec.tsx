import '@testing-library/jest-dom/vitest';
import type { InstituteStatus, SetupStatus } from '@roviq/common-types';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen } from '@testing-library/react';
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
        contact: { phones: [], emails: [] },
        address: null,
        identifiers: [],
        affiliations: [],
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
  useRestoreInstitute: () => mutation,
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
