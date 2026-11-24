import '@testing-library/jest-dom/vitest';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../../../../../__test-utils__/render-with-providers';
import type { RolloverMove, RolloverPreview, RolloverSection } from '../use-academic-years';

const { instituteAcademicYears: ids } = testIds;

const activateYearMock = vi.fn();
const setSectionTargetMock = vi.fn();
const previewState: { preview: RolloverPreview | null; loading: boolean } = {
  preview: null,
  loading: false,
};
const previewArgs: Array<string | null> = [];

vi.mock('../use-academic-years', () => ({
  useActivateAcademicYear: () => ({ activateYear: activateYearMock, loading: false }),
  useSetRolloverSectionMap: () => ({ setSectionTarget: setSectionTargetMock, loading: false }),
  useAcademicYearRolloverPreview: (academicYearId: string | null) => {
    previewArgs.push(academicYearId);
    return { ...previewState, error: undefined };
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ActivateYearDialog } from '../activate-year-dialog';

const YEAR = { id: 'year-2026', label: '2026-27' };

function preview(overrides: Partial<RolloverPreview>): RolloverPreview {
  return {
    movingUp: 0,
    staying: 0,
    completing: 0,
    notCarried: 0,
    noClassInNewYear: 0,
    alreadyPlaced: 0,
    sections: [],
    moves: [],
    ...overrides,
  };
}

function section(
  sectionId: string,
  name: string,
  numbers: Partial<Pick<RolloverSection, 'currentStrength' | 'incoming' | 'capacity'>> = {},
): RolloverSection {
  return {
    sectionId,
    standardId: 'class-6',
    standardName: { en: 'Class 6', hi: 'कक्षा 6' },
    sectionName: { en: name },
    currentStrength: 0,
    incoming: 0,
    capacity: 45,
    ...numbers,
  };
}

function move(overrides: Partial<RolloverMove>): RolloverMove {
  return {
    fromSectionId: 'from-5b',
    fromStandardName: { en: 'Class 5' },
    fromSectionName: { en: 'B' },
    toStandardId: 'class-6',
    toSectionId: 'to-6b',
    students: 30,
    overridden: false,
    ...overrides,
  };
}

async function open() {
  renderWithProviders(<ActivateYearDialog year={YEAR} />);
  await userEvent.click(screen.getByTestId(ids.activateBtn(YEAR.id)));
  return screen.findByTestId(ids.activateDialog);
}

describe('ActivateYearDialog', () => {
  beforeEach(() => {
    activateYearMock.mockReset();
    setSectionTargetMock.mockReset();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    previewArgs.length = 0;
    previewState.preview = null;
    previewState.loading = false;
  });

  it('should load the preview only once the dialog opens', async () => {
    renderWithProviders(<ActivateYearDialog year={YEAR} />);
    expect(previewArgs.every((id) => id === null)).toBe(true);

    await userEvent.click(screen.getByTestId(ids.activateBtn(YEAR.id)));

    expect(previewArgs.at(-1)).toBe(YEAR.id);
  });

  it('should show one sentence per non-zero count and skip the zero ones', async () => {
    previewState.preview = preview({ movingUp: 12, staying: 1, notCarried: 3 });

    const dialog = await open();

    const list = within(dialog).getByTestId(ids.activatePreview);
    expect(within(list).getByTestId(ids.activatePreviewLine('movingUp'))).toHaveTextContent(
      '12 students move up to the next class.',
    );
    expect(within(list).getByTestId(ids.activatePreviewLine('staying'))).toHaveTextContent(
      '1 student stays in the same class.',
    );
    expect(within(list).getByTestId(ids.activatePreviewLine('notCarried'))).toHaveTextContent(
      '3 students are marked completed or transferred and will not be carried.',
    );
    expect(within(list).queryByTestId(ids.activatePreviewLine('completing'))).toBeNull();
    expect(within(list).queryByTestId(ids.activatePreviewLine('alreadyPlaced'))).toBeNull();
    expect(within(list).queryByTestId(ids.activatePreviewWarning)).toBeNull();
  });

  it('should warn when students have no class waiting in the new year', async () => {
    previewState.preview = preview({ noClassInNewYear: 4 });

    const dialog = await open();

    expect(within(dialog).getByTestId(ids.activatePreviewWarning)).toHaveTextContent(
      '4 students have no class or section waiting in the new year and will be left out. Create the missing classes and sections in the new year first.',
    );
  });

  it('should say nothing moves when every count is zero', async () => {
    previewState.preview = preview({});

    const dialog = await open();

    expect(within(dialog).getByText('No students will be moved.')).toBeInTheDocument();
  });

  it('should activate and close on confirm', async () => {
    previewState.preview = preview({ movingUp: 1 });
    activateYearMock.mockResolvedValue({});
    await open();

    await userEvent.click(screen.getByTestId(ids.activateConfirmBtn));

    expect(activateYearMock).toHaveBeenCalledWith(YEAR.id);
    expect(toast.success).toHaveBeenCalledWith('2026-27 is now the active academic year');
    expect(screen.queryByTestId(ids.activateDialog)).toBeNull();
  });

  it('should show the translated error for the error code', async () => {
    previewState.preview = preview({});
    activateYearMock.mockRejectedValue(
      new CombinedGraphQLErrors({
        errors: [{ message: 'raw server text', extensions: { code: 'YEAR_ALREADY_ACTIVE' } }],
      }),
    );
    await open();

    await userEvent.click(screen.getByTestId(ids.activateConfirmBtn));

    expect(toast.error).toHaveBeenCalledWith('Another academic year is already active.');
  });

  describe('where each section goes', () => {
    it('should not show the table when no section has students to move', async () => {
      previewState.preview = preview({ sections: [section('to-6b', 'B')] });

      const dialog = await open();

      expect(within(dialog).queryByTestId(ids.activateSectionTable)).toBeNull();
    });

    it('should show the students, the target section and the size against the limit', async () => {
      previewState.preview = preview({
        movingUp: 30,
        sections: [section('to-6b', 'B', { currentStrength: 2, incoming: 30 })],
        moves: [move({})],
      });

      const dialog = await open();

      const row = within(dialog).getByTestId(ids.activateSectionRow('from-5b'));
      expect(row).toHaveTextContent('Class 5 · B');
      expect(row).toHaveTextContent('30');
      expect(
        within(row).getByRole('combobox', { name: 'Section for the students of Class 5 · B' }),
      ).toHaveTextContent('Class 6 · B');
      expect(within(row).getByTestId(ids.activateSectionSize('from-5b'))).toHaveTextContent(
        '32 of 45',
      );
      expect(within(dialog).queryByTestId(ids.activateCapacityWarning)).toBeNull();
    });

    it('should warn about every section that would go over the limit', async () => {
      previewState.preview = preview({
        sections: [
          section('to-6a', 'A', { incoming: 44 }),
          section('to-6b', 'B', { currentStrength: 20, incoming: 30 }),
        ],
        moves: [move({})],
      });

      const dialog = await open();

      expect(within(dialog).getByTestId(ids.activateCapacityWarning)).toHaveTextContent(
        '1 section would go over the limit of 45 students: Class 6 · B (50). The students are placed anyway. Add a section in the new year, or change where a section goes.',
      );
      expect(within(dialog).getByTestId(ids.activateSectionSize('from-5b'))).toHaveAccessibleName(
        /Over the limit/,
      );
    });

    it('should list the students of a section who go elsewhere or have no class', async () => {
      previewState.preview = preview({
        sections: [section('to-6b', 'B'), { ...section('to-5b', 'B'), standardId: 'class-5' }],
        moves: [
          move({}),
          move({ toStandardId: 'class-5', toSectionId: 'to-5b', students: 2 }),
          move({ toStandardId: null, toSectionId: null, students: 1 }),
        ],
      });

      const dialog = await open();

      const others = within(dialog).getByTestId(ids.activateSectionOther('from-5b'));
      expect(others).toHaveTextContent('2 students go to Class 6 · B');
      expect(others).toHaveTextContent('1 student has no class or section in the new year');
    });

    it('should say so when the students of a section have no class waiting', async () => {
      previewState.preview = preview({
        moves: [move({ toStandardId: null, toSectionId: null })],
      });

      const dialog = await open();

      const row = within(dialog).getByTestId(ids.activateSectionRow('from-5b'));
      expect(row).toHaveTextContent('No class or section in the new year');
      expect(within(row).queryByRole('combobox')).toBeNull();
    });

    it('should save the chosen section, offering only sections of the same class', async () => {
      previewState.preview = preview({
        sections: [
          section('to-6b', 'B'),
          section('to-6c', 'C'),
          { ...section('to-5b', 'Other'), standardId: 'class-5' },
        ],
        moves: [move({})],
      });
      setSectionTargetMock.mockResolvedValue({});
      const dialog = await open();

      await userEvent.click(within(dialog).getByTestId(ids.activateSectionSelect('from-5b')));
      expect(screen.queryByRole('option', { name: 'Class 6 · Other' })).toBeNull();
      expect(screen.queryByRole('option', { name: 'Same name (automatic)' })).toBeNull();
      await userEvent.click(await screen.findByRole('option', { name: 'Class 6 · C' }));

      expect(setSectionTargetMock).toHaveBeenCalledWith(YEAR.id, {
        fromSectionId: 'from-5b',
        toSectionId: 'to-6c',
      });
      expect(toast.success).toHaveBeenCalledWith('Section choice saved');
    });

    it('should offer the automatic choice for an overridden section and clear it', async () => {
      previewState.preview = preview({
        sections: [section('to-6b', 'B'), section('to-6c', 'C')],
        moves: [move({ toSectionId: 'to-6c', overridden: true })],
      });
      setSectionTargetMock.mockResolvedValue({});
      const dialog = await open();

      await userEvent.click(within(dialog).getByTestId(ids.activateSectionSelect('from-5b')));
      await userEvent.click(await screen.findByRole('option', { name: 'Same name (automatic)' }));

      expect(setSectionTargetMock).toHaveBeenCalledWith(YEAR.id, {
        fromSectionId: 'from-5b',
        toSectionId: null,
      });
    });

    it('should show the translated error when saving a section choice is refused', async () => {
      previewState.preview = preview({
        sections: [section('to-6b', 'B'), section('to-6c', 'C')],
        moves: [move({})],
      });
      setSectionTargetMock.mockRejectedValue(
        new CombinedGraphQLErrors({
          errors: [{ message: 'raw server text', extensions: { code: 'SECTION_NOT_FOUND' } }],
        }),
      );
      const dialog = await open();

      await userEvent.click(within(dialog).getByTestId(ids.activateSectionSelect('from-5b')));
      await userEvent.click(await screen.findByRole('option', { name: 'Class 6 · C' }));

      expect(toast.error).toHaveBeenCalledWith(
        'That section was not found in the chosen class. Refresh and try again.',
      );
      expect(toast.success).not.toHaveBeenCalledWith('Section choice saved');
    });
  });
});
