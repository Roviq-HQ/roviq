import '@testing-library/jest-dom/vitest';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import errorsEn from '../../../../../../../../messages/en/error.json';
import { renderWithProviders } from '../../../../../../../__test-utils__/render-with-providers';

const { instituteStudents: ids } = testIds;

const enrollMock = vi.fn();
const changeClassMock = vi.fn();
const removeMock = vi.fn();

vi.mock('../use-students', () => ({
  useEnrollStudent: () => [enrollMock, { loading: false }],
  useChangeStudentClass: () => [changeClassMock, { loading: false }],
  useRemoveStudentFromYear: () => [removeMock, { loading: false }],
}));

const SECTIONS: Record<string, { id: string; displayLabel: string; name: { en: string } }[]> = {
  'std-5': [{ id: 'sec-5a', displayLabel: '5-A', name: { en: '5-A' } }],
  'std-6': [
    { id: 'sec-6a', displayLabel: '6-A', name: { en: '6-A' } },
    { id: 'sec-6b', displayLabel: '6-B', name: { en: '6-B' } },
  ],
};

vi.mock('@web/app/[locale]/institute/(dashboard)/academics/use-academics', () => ({
  useStandards: () => ({
    standards: [
      { id: 'std-5', name: { en: 'Class 5' } },
      { id: 'std-6', name: { en: 'Class 6' } },
    ],
  }),
  useSections: (standardId: string | null) => ({
    sections: standardId ? (SECTIONS[standardId] ?? []) : [],
  }),
}));

vi.mock('../../../../../../../hooks/use-media-query', () => ({
  useMediaQuery: () => false,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ChangeClassDialog, EnrolStudentDialog, RemoveFromYearDialog } from '../placement-dialogs';

const graphQLError = (code: string) =>
  new CombinedGraphQLErrors({ errors: [{ message: 'raw server text', extensions: { code } }] });

const optionNames = () => screen.getAllByRole('option').map((option) => option.textContent);

async function pick(label: 'Standard' | 'Section', option: string) {
  await userEvent.click(screen.getByRole('combobox', { name: label }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

describe('EnrolStudentDialog', () => {
  const renderDialog = () => {
    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();
    renderWithProviders(
      <EnrolStudentDialog
        open
        onOpenChange={onOpenChange}
        studentProfileId="stu-1"
        studentName="Rajesh Kumar"
        academicYearId="year-2026"
        yearLabel="2026-27"
        onSuccess={onSuccess}
      />,
    );
    return { onOpenChange, onSuccess };
  };

  beforeEach(() => {
    enrollMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it('should offer only the sections of the chosen class and enrol into the chosen one', async () => {
    enrollMock.mockResolvedValue({ data: { enrollStudent: 'sa-new' } });
    const { onOpenChange, onSuccess } = renderDialog();
    expect(screen.getByTestId(ids.placementSubmitBtn)).toBeDisabled();

    await pick('Standard', 'Class 6');
    await userEvent.click(screen.getByRole('combobox', { name: 'Section' }));
    expect(optionNames()).toEqual(['6-A', '6-B']);
    await userEvent.keyboard('{Escape}');

    await pick('Standard', 'Class 5');
    expect(screen.getByRole('combobox', { name: 'Section' })).not.toHaveTextContent('6-');
    await userEvent.click(screen.getByRole('combobox', { name: 'Section' }));
    expect(optionNames()).toEqual(['5-A']);
    await userEvent.click(screen.getByRole('option', { name: '5-A' }));
    await userEvent.click(screen.getByTestId(ids.placementSubmitBtn));

    expect(enrollMock).toHaveBeenCalledWith({
      variables: {
        input: {
          studentProfileId: 'stu-1',
          academicYearId: 'year-2026',
          standardId: 'std-5',
          sectionId: 'sec-5a',
        },
      },
    });
    expect(toast.success).toHaveBeenCalledWith('Rajesh Kumar enrolled in 2026-27');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it.each([
    'STUDENT_ALREADY_ENROLLED',
    'SECTION_CAPACITY_EXCEEDED',
  ] as const)('should show the translated copy for %s and stay open', async (code) => {
    enrollMock.mockRejectedValue(graphQLError(code));
    const { onOpenChange, onSuccess } = renderDialog();

    await pick('Standard', 'Class 5');
    await pick('Section', '5-A');
    await userEvent.click(screen.getByTestId(ids.placementSubmitBtn));

    expect(toast.error).toHaveBeenCalledWith(errorsEn[code]);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

describe('ChangeClassDialog', () => {
  const renderDialog = () => {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <ChangeClassDialog
        open
        onOpenChange={onOpenChange}
        studentAcademicId="sa-1"
        academicYearId="year-2026"
        yearLabel="2026-27"
        currentStandardId="std-6"
        currentSectionId="sec-6a"
      />,
    );
    return { onOpenChange };
  };

  beforeEach(() => {
    changeClassMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it('should start on the current class and section and refuse to save them unchanged', async () => {
    renderDialog();

    expect(screen.getByRole('combobox', { name: 'Standard' })).toHaveTextContent('Class 6');
    expect(screen.getByRole('combobox', { name: 'Section' })).toHaveTextContent('6-A');
    expect(screen.getByTestId(ids.placementSubmitBtn)).toBeDisabled();
    expect(screen.queryByTestId(ids.placementOverrideReasonInput)).not.toBeInTheDocument();
  });

  it('should move the student without an override reason when the section has room', async () => {
    changeClassMock.mockResolvedValue({ data: { changeStudentClass: 'sa-1' } });
    const { onOpenChange } = renderDialog();

    await pick('Section', '6-B');
    await userEvent.click(screen.getByTestId(ids.placementSubmitBtn));

    expect(changeClassMock).toHaveBeenCalledWith({
      variables: {
        input: {
          studentAcademicId: 'sa-1',
          standardId: 'std-6',
          sectionId: 'sec-6b',
          overrideReason: undefined,
        },
      },
    });
    expect(toast.success).toHaveBeenCalledWith('Class changed');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('should ask for an override reason only after the API reports a full section', async () => {
    changeClassMock
      .mockRejectedValueOnce(graphQLError('SECTION_CAPACITY_EXCEEDED'))
      .mockResolvedValueOnce({ data: { changeStudentClass: 'sa-1' } });
    renderDialog();

    await pick('Standard', 'Class 5');
    await pick('Section', '5-A');
    await userEvent.click(screen.getByTestId(ids.placementSubmitBtn));

    expect(toast.error).toHaveBeenCalledWith(errorsEn.SECTION_CAPACITY_EXCEEDED);
    expect(screen.getByTestId(ids.placementSubmitBtn)).toBeDisabled();
    await userEvent.type(
      screen.getByTestId(ids.placementOverrideReasonInput),
      '  Sibling in this section  ',
    );
    await userEvent.click(screen.getByTestId(ids.placementSubmitBtn));

    expect(changeClassMock).toHaveBeenLastCalledWith({
      variables: {
        input: {
          studentAcademicId: 'sa-1',
          standardId: 'std-5',
          sectionId: 'sec-5a',
          overrideReason: 'Sibling in this section',
        },
      },
    });
  });
});

describe('RemoveFromYearDialog', () => {
  const renderDialog = () => {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <RemoveFromYearDialog
        open
        onOpenChange={onOpenChange}
        studentAcademicId="sa-1"
        yearLabel="2026-27"
      />,
    );
    return { onOpenChange };
  };

  beforeEach(() => {
    removeMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it('should require a reason of at least 3 characters and send it trimmed', async () => {
    removeMock.mockResolvedValue({ data: { removeStudentFromYear: true } });
    const { onOpenChange } = renderDialog();

    await userEvent.type(screen.getByTestId(ids.removeFromYearReasonInput), '  ab  ');
    await userEvent.click(screen.getByTestId(ids.removeFromYearConfirmBtn));
    expect(removeMock).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a reason of 3 to 500 characters.')).toBeInTheDocument();
    expect(screen.getByTestId(ids.removeFromYearConfirmBtn)).toBeDisabled();

    await userEvent.type(screen.getByTestId(ids.removeFromYearReasonInput), 'c by mistake');
    await userEvent.click(screen.getByTestId(ids.removeFromYearConfirmBtn));

    expect(removeMock).toHaveBeenCalledWith({
      variables: { studentAcademicId: 'sa-1', reason: 'ab  c by mistake' },
    });
    expect(toast.success).toHaveBeenCalledWith('Removed from 2026-27');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('should show the translated copy when the year already has records', async () => {
    removeMock.mockRejectedValue(graphQLError('STUDENT_YEAR_HAS_RECORDS'));
    const { onOpenChange } = renderDialog();

    await userEvent.type(screen.getByTestId(ids.removeFromYearReasonInput), 'Enrolled by mistake');
    await userEvent.click(screen.getByTestId(ids.removeFromYearConfirmBtn));

    expect(toast.error).toHaveBeenCalledWith(errorsEn.STUDENT_YEAR_HAS_RECORDS);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
