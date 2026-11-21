/**
 * The "Get started" cards prompt only for what the institute is missing: each card appears
 * once its count is known to be zero, and the section disappears when nothing is missing.
 */
import type { MockedResponse } from '@apollo/client/testing';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../../../../__test-utils__/render-with-providers';

const { instituteDashboard } = testIds;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/en/institute/dashboard',
}));

// The KPI cards have their own specs and queries.
vi.mock('../today-schedule-card', () => ({ TodayScheduleCard: () => null }));
vi.mock('../exams-summary-card', () => ({ ExamsSummaryCard: () => null }));
vi.mock('../../attendance/use-attendance', () => ({
  useDateSummary: () => ({ summary: null, loading: false }),
}));

import DashboardPage from '../page';
import { STAFF_COUNT_QUERY, STANDARD_IDS_QUERY, STUDENT_COUNT_QUERY } from '../use-setup-counts';

function countMocks(counts: { students: number; staff: number; standards: number }) {
  const mocks: MockedResponse[] = [
    {
      request: { query: STUDENT_COUNT_QUERY },
      result: {
        data: {
          studentStatistics: { __typename: 'StudentStatisticsModel', total: counts.students },
        },
      },
    },
    {
      request: { query: STAFF_COUNT_QUERY },
      result: { data: { staffStatistics: { __typename: 'StaffStatistics', total: counts.staff } } },
    },
    {
      request: { query: STANDARD_IDS_QUERY },
      result: {
        data: {
          standards: Array.from({ length: counts.standards }, (_, i) => ({
            __typename: 'StandardModel',
            id: `std-${i}`,
          })),
        },
      },
    },
  ];
  return mocks;
}

describe('Dashboard get-started cards', () => {
  it('drops the cards of records the institute already has', async () => {
    renderWithProviders(<DashboardPage />, {
      apolloMocks: countMocks({ students: 120, staff: 8, standards: 0 }),
    });

    // The standards card proves the counts arrived; the seeded records get no card.
    expect(await screen.findByTestId(instituteDashboard.getStartedCard('standards'))).toBeVisible();
    expect(
      screen.queryByTestId(instituteDashboard.getStartedCard('students')),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(instituteDashboard.getStartedCard('staff')),
    ).not.toBeInTheDocument();
  });

  it('shows only the cards whose records are missing', async () => {
    renderWithProviders(<DashboardPage />, {
      apolloMocks: countMocks({ students: 0, staff: 3, standards: 0 }),
    });

    expect(await screen.findByTestId(instituteDashboard.getStartedCard('students'))).toBeVisible();
    expect(await screen.findByTestId(instituteDashboard.getStartedCard('standards'))).toBeVisible();
    expect(
      screen.queryByTestId(instituteDashboard.getStartedCard('staff')),
    ).not.toBeInTheDocument();
  });

  it('shows no section while the counts are unknown', () => {
    renderWithProviders(<DashboardPage />, {
      apolloMocks: countMocks({ students: 0, staff: 0, standards: 0 }),
    });

    expect(screen.queryByTestId(instituteDashboard.getStarted)).not.toBeInTheDocument();
  });

  it('does not ask for a count the role cannot read', async () => {
    renderWithProviders(<DashboardPage />, {
      abilityRules: [{ action: 'read', subject: 'Standard' }],
      apolloMocks: countMocks({ students: 0, staff: 0, standards: 0 }),
    });

    expect(await screen.findByTestId(instituteDashboard.getStartedCard('standards'))).toBeVisible();
    expect(
      screen.queryByTestId(instituteDashboard.getStartedCard('students')),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(instituteDashboard.getStartedCard('staff')),
    ).not.toBeInTheDocument();
  });
});
