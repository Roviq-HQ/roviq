import '@testing-library/jest-dom/vitest';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import errorEn from '../../../../../../../messages/en/error.json';

const { instituteExaminations: ex } = testIds;

const mocks = vi.hoisted(() => ({ createScheme: vi.fn(), createReportCard: vi.fn() }));

vi.mock('@web/components/pickers/academic-year-picker', () => ({
  AcademicYearSelector: () => null,
  useSelectedAcademicYear: () => ({ yearId: 'year-2026', loading: false }),
}));

vi.mock('../use-examinations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../use-examinations')>()),
  useGradingSchemes: () => ({ schemes: [], loading: false }),
  useDeleteGradingScheme: () => ({ deleteScheme: vi.fn() }),
  useCreateGradingScheme: () => ({ createScheme: mocks.createScheme, loading: false }),
  useReportCards: () => ({ reportCards: [], loading: false }),
  useCreateReportCard: () => ({ createReportCard: mocks.createReportCard, loading: false }),
  useExamTerms: () => ({ terms: [] }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import GradingSchemesPage from '../grading-schemes/page';
import ReportCardsPage from '../report-cards/page';

function rejection(code: string) {
  return new CombinedGraphQLErrors({
    errors: [{ message: 'raw server text', extensions: { code } }],
  });
}

describe('examination names that are already taken (ROV-358)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the translated message for a taken grading scheme name', async () => {
    mocks.createScheme.mockRejectedValue(rejection('GRADING_SCHEME_NAME_DUPLICATE'));
    renderWithProviders(<GradingSchemesPage />);

    await userEvent.click(screen.getByTestId(ex.gradingCreateBtn));
    await userEvent.type(await screen.findByTestId(ex.gradingNameInput), 'CBSE 9-point');
    await userEvent.click(screen.getByTestId(ex.gradingSubmitBtn));

    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(errorEn.GRADING_SCHEME_NAME_DUPLICATE),
    );
    expect(toast.error).not.toHaveBeenCalledWith('raw server text');
  });

  it('shows the translated message for a repeated grade', async () => {
    mocks.createScheme.mockRejectedValue(rejection('GRADING_SCHEME_INVALID_BANDS'));
    renderWithProviders(<GradingSchemesPage />);

    await userEvent.click(screen.getByTestId(ex.gradingCreateBtn));
    await userEvent.type(await screen.findByTestId(ex.gradingNameInput), 'CBSE 9-point');
    await userEvent.click(screen.getByTestId(ex.gradingSubmitBtn));

    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(errorEn.GRADING_SCHEME_INVALID_BANDS),
    );
  });

  it('shows the translated message for a taken report card name', async () => {
    mocks.createReportCard.mockRejectedValue(rejection('REPORT_CARD_NAME_DUPLICATE'));
    renderWithProviders(<ReportCardsPage />);

    await userEvent.click(screen.getByTestId(ex.reportCardsCreateBtn));
    await userEvent.type(await screen.findByTestId(ex.reportCardNameInput), 'Term 1');
    await userEvent.click(screen.getByTestId(ex.reportCardSubmitBtn));

    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(errorEn.REPORT_CARD_NAME_DUPLICATE),
    );
    expect(toast.error).not.toHaveBeenCalledWith('raw server text');
  });
});
