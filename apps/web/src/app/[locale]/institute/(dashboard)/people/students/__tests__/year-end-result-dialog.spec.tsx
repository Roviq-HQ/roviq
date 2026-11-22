import '@testing-library/jest-dom/vitest';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { PromotionStatus } from '@roviq/common-types';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../../../../../../__test-utils__/render-with-providers';
import type { StudentListNode } from '../use-students';

const { instituteStudents: ids } = testIds;

const setDecisionsMock = vi.fn();

vi.mock('../use-students', () => ({
  useSetPromotionDecisions: () => [setDecisionsMock, { loading: false }],
}));

vi.mock('../../../../../../../hooks/use-media-query', () => ({
  useMediaQuery: () => false,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { YearEndResultDialog } from '../year-end-result-dialog';

type SelectedStudent = Pick<StudentListNode, 'id' | 'currentStudentAcademicId'>;

function student(id: string, currentStudentAcademicId: string | null): SelectedStudent {
  return { id, currentStudentAcademicId };
}

function renderDialog(students: SelectedStudent[]) {
  const onOpenChange = vi.fn();
  const onSuccess = vi.fn();
  renderWithProviders(
    <YearEndResultDialog
      open
      onOpenChange={onOpenChange}
      students={students}
      onSuccess={onSuccess}
    />,
  );
  return { onOpenChange, onSuccess };
}

describe('YearEndResultDialog', () => {
  beforeEach(() => {
    setDecisionsMock.mockReset();
  });

  it('should keep Apply disabled until a result is chosen', async () => {
    renderDialog([student('s1', 'sa-1')]);

    expect(screen.getByTestId(ids.yearEndApplyBtn)).toBeDisabled();
    await userEvent.click(screen.getByTestId(ids.yearEndOption(PromotionStatus.DETAINED)));

    expect(screen.getByTestId(ids.yearEndApplyBtn)).toBeEnabled();
    expect(screen.getByTestId(ids.yearEndOption(PromotionStatus.DETAINED))).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it("should send every selected student's year record id in one call and refetch", async () => {
    setDecisionsMock.mockResolvedValue({ data: { setPromotionDecisions: 2 } });
    const { onOpenChange, onSuccess } = renderDialog([
      student('s1', 'sa-1'),
      student('s2', 'sa-2'),
    ]);

    await userEvent.click(screen.getByTestId(ids.yearEndOption(PromotionStatus.GRADUATED)));
    await userEvent.click(screen.getByTestId(ids.yearEndApplyBtn));

    expect(setDecisionsMock).toHaveBeenCalledTimes(1);
    expect(setDecisionsMock).toHaveBeenCalledWith({
      variables: {
        input: { studentAcademicIds: ['sa-1', 'sa-2'], status: PromotionStatus.GRADUATED },
      },
    });
    expect(toast.success).toHaveBeenCalledWith('Saved the result for 2 students');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('should skip and name students without a current-year record', async () => {
    setDecisionsMock.mockResolvedValue({ data: { setPromotionDecisions: 1 } });
    renderDialog([student('s1', 'sa-1'), student('s2', null)]);

    expect(screen.getByTestId(ids.yearEndMissingRecord)).toHaveTextContent(
      '1 student has no record in the current year and will be skipped.',
    );
    await userEvent.click(screen.getByTestId(ids.yearEndOption(PromotionStatus.PENDING)));
    await userEvent.click(screen.getByTestId(ids.yearEndApplyBtn));

    expect(setDecisionsMock).toHaveBeenCalledWith({
      variables: { input: { studentAcademicIds: ['sa-1'], status: PromotionStatus.PENDING } },
    });
  });

  it('should show the translated error for the error code and stay open', async () => {
    setDecisionsMock.mockRejectedValue(
      new CombinedGraphQLErrors({
        errors: [
          { message: 'raw server text', extensions: { code: 'STUDENT_ACADEMIC_NOT_FOUND' } },
        ],
      }),
    );
    const { onOpenChange, onSuccess } = renderDialog([student('s1', 'sa-1')]);

    await userEvent.click(screen.getByTestId(ids.yearEndOption(PromotionStatus.PROMOTED)));
    await userEvent.click(screen.getByTestId(ids.yearEndApplyBtn));

    expect(toast.error).toHaveBeenCalledWith(
      'One or more of the selected students has no record in this academic year. Refresh the list and try again.',
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
