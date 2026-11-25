import '@testing-library/jest-dom/vitest';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import errorEn from '../../../../../../../messages/en/error.json';
import errorHi from '../../../../../../../messages/hi/error.json';

const { instituteExaminations: ex } = testIds;

const mocks = vi.hoisted(() => ({ createExam: vi.fn() }));

vi.mock('@web/components/pickers/academic-year-picker', () => ({
  AcademicYearSelector: () => null,
  useSelectedAcademicYear: () => ({ yearId: 'year-2026' }),
}));

vi.mock('../use-examinations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../use-examinations')>()),
  useExams: () => ({ exams: [], loading: false }),
  useDeleteExam: () => ({ deleteExam: vi.fn() }),
  useCreateExam: () => ({ createExam: mocks.createExam, loading: false }),
  useExamTerms: () => ({ terms: [] }),
  useGradingSchemes: () => ({ schemes: [] }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import ExaminationsPage from '../page';

async function submitExam(locale: 'en' | 'hi') {
  renderWithProviders(<ExaminationsPage />, { locale });
  await userEvent.click(screen.getByTestId(ex.createButton));
  await userEvent.type(await screen.findByTestId(ex.wizardNameInput), 'Half Yearly');
  await userEvent.click(screen.getByTestId(ex.wizardSubmitBtn));
}

describe('ExaminationsPage new exam (ROV-358)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createExam.mockRejectedValue(
      new CombinedGraphQLErrors({
        errors: [{ message: 'raw server text', extensions: { code: 'EXAM_NAME_DUPLICATE' } }],
      }),
    );
  });

  it('shows the translated taken-name message', async () => {
    await submitExam('en');

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(errorEn.EXAM_NAME_DUPLICATE));
    expect(toast.error).not.toHaveBeenCalledWith('raw server text');
    expect(screen.getByTestId(ex.wizard)).toBeInTheDocument();
  });

  it('shows the taken-name message in Hindi', async () => {
    await submitExam('hi');

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(errorHi.EXAM_NAME_DUPLICATE));
  });
});
