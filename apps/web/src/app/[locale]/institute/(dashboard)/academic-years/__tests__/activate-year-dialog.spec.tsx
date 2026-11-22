import '@testing-library/jest-dom/vitest';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../../../../../__test-utils__/render-with-providers';
import type { RolloverPreview } from '../use-academic-years';

const { instituteAcademicYears: ids } = testIds;

const activateYearMock = vi.fn();
const previewState: { preview: RolloverPreview | null; loading: boolean } = {
  preview: null,
  loading: false,
};
const previewArgs: Array<string | null> = [];

vi.mock('../use-academic-years', () => ({
  useActivateAcademicYear: () => ({ activateYear: activateYearMock, loading: false }),
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
});
