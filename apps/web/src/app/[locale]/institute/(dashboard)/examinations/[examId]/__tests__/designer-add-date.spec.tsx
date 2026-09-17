import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { addDays, endOfMonth, isToday, min } from 'date-fns';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatesheetDesigner } from '../page';

const { instituteExaminations: ex } = testIds;

const mocks = vi.hoisted(() => ({ updateExam: vi.fn() }));

vi.mock('../../use-examinations', () => ({
  useUpdateExam: () => ({ updateExam: mocks.updateExam, loading: false }),
}));

vi.mock('../../../academics/use-academics', () => ({
  useStandards: () => ({ standards: [{ id: 'std-1', name: { en: 'Class 5' } }] }),
  useSectionsByAcademicYear: () => ({ sections: [], loading: false }),
}));

vi.mock('../../../holiday/use-holiday', () => ({
  useHolidays: () => ({ holidays: [] }),
}));

const PROPS = {
  examId: 'exam-1',
  academicYearId: 'ay-1',
  startDate: '2026-04-20',
  endDate: '2026-04-20',
  schedules: [],
  subjectName: () => '',
};

function paperOn(examDate: string) {
  return {
    id: `paper-${examDate}`,
    examId: 'exam-1',
    sectionId: 'sec-1',
    subjectId: 'sub-1',
    component: 'THEORY' as const,
    examDate,
    startTime: null,
    endTime: null,
    maxMarks: 100,
    passMarks: null,
    room: null,
    invigilatorId: null,
  };
}

// Day-picker buttons carry a full long-date accessible name ("Thursday,
// April 23rd, 2026", prefixed when the day is today). Built manually:
// date-fns `format` is banned outside @roviq/i18n, and hooks can't run here.
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
function daySuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'th';
  switch (day % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}
function dayLabel(d: Date): string {
  const day = d.getDate();
  const base = `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${day}${daySuffix(day)}, ${d.getFullYear()}`;
  return isToday(d) ? `Today, ${base}` : base;
}

async function pickDate(user: UserEvent, iso: string) {
  await user.click(screen.getByTestId(ex.designerAddDateInput));
  const [y, m, d] = iso.split('-').map(Number);
  await user.click(screen.getByRole('button', { name: dayLabel(new Date(y, m - 1, d)) }));
}

// Columns are sparse: range days, scheduled-paper dates, and session-added
// dates — adding one never fills the span, and only edge trims rewrite
// the range.
describe('designer dates', () => {
  beforeEach(() => {
    mocks.updateExam.mockClear();
  });

  it('should render the add control inside the matrix header, not above it', () => {
    renderWithProviders(<DatesheetDesigner {...PROPS} />);

    const table = screen.getByRole('table');
    expect(within(table).getByLabelText('Add date')).toBeInTheDocument();
  });

  it('should show dd/MM/yyyy and add only the picked date', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DatesheetDesigner {...PROPS} />);

    await pickDate(user, '2026-04-23');
    expect(screen.getByTestId(ex.designerAddDateInput)).toHaveTextContent('23/04/2026');

    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('23/04/2026')).toBeInTheDocument();
    expect(screen.queryByText('21/04/2026')).not.toBeInTheDocument();
    expect(screen.queryByText('22/04/2026')).not.toBeInTheDocument();
    expect(mocks.updateExam).not.toHaveBeenCalled();
  });

  it('should scroll a newly added column into view', async () => {
    const scrollMock = vi.fn();
    const original = window.HTMLElement.prototype.scrollIntoView;
    window.HTMLElement.prototype.scrollIntoView = scrollMock;
    try {
      const user = userEvent.setup();
      renderWithProviders(<DatesheetDesigner {...PROPS} />);

      await pickDate(user, '2026-04-23');
      await user.click(screen.getByRole('button', { name: 'Add' }));

      expect(scrollMock).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    } finally {
      window.HTMLElement.prototype.scrollIntoView = original;
    }
  });

  it('should insert an added date between existing columns', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DatesheetDesigner {...PROPS} />);
    const add = screen.getByRole('button', { name: 'Add' });

    await pickDate(user, '2026-04-23');
    await user.click(add);
    await pickDate(user, '2026-04-21');
    await user.click(add);

    for (const label of ['20/04/2026', '21/04/2026', '23/04/2026']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText('22/04/2026')).not.toBeInTheDocument();
  });

  it('should fill gaps one day at a time via the between-dates button', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DatesheetDesigner {...PROPS} />);

    // Consecutive dates: no gap button.
    expect(screen.queryByTestId(ex.designerDateGapAdd('2026-04-21'))).not.toBeInTheDocument();

    await pickDate(user, '2026-04-23');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    // Gap 20 → 23: button adds the next missing day (21st).
    await user.click(screen.getByTestId(ex.designerDateGapAdd('2026-04-21')));
    expect(screen.getByText('21/04/2026')).toBeInTheDocument();
    expect(screen.queryByText('22/04/2026')).not.toBeInTheDocument();
  });

  it('should show scheduled-paper dates as columns even outside the range', () => {
    renderWithProviders(<DatesheetDesigner {...PROPS} schedules={[paperOn('2026-05-01')]} />);

    expect(screen.getByText('01/05/2026')).toBeInTheDocument();
  });

  it('should disable Add for empty or already-covered dates', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DatesheetDesigner {...PROPS} />);

    const add = screen.getByRole('button', { name: 'Add' });
    expect(add).toBeDisabled();

    await pickDate(user, '2026-04-20');
    expect(add).toBeDisabled();

    await pickDate(user, '2026-04-21');
    expect(add).toBeEnabled();
  });

  it('should remove an added date only after confirm', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DatesheetDesigner {...PROPS} />);

    // Range dates carry no delete affordance.
    expect(screen.queryByTestId(ex.designerDateDelete('2026-04-20'))).not.toBeInTheDocument();

    await pickDate(user, '2026-04-23');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await user.click(screen.getByTestId(ex.designerDateDelete('2026-04-23')));
    expect(screen.getByTestId(ex.designerDeleteDateDialog)).toBeInTheDocument();

    // Cancel keeps the column.
    await user.click(screen.getByTestId(ex.designerDeleteDateCancel));
    expect(screen.getByText('23/04/2026')).toBeInTheDocument();

    // Confirm removes it without touching the range.
    await user.click(screen.getByTestId(ex.designerDateDelete('2026-04-23')));
    await user.click(screen.getByTestId(ex.designerDeleteDateConfirm));
    expect(screen.queryByText('23/04/2026')).not.toBeInTheDocument();
    expect(mocks.updateExam).not.toHaveBeenCalled();
  });

  it('should hide the delete affordance on dates with scheduled papers', async () => {
    const user = userEvent.setup();
    const view = renderWithProviders(
      <DatesheetDesigner {...PROPS} schedules={[paperOn('2026-04-20')]} />,
    );

    // Range date with papers: no ×.
    expect(screen.queryByTestId(ex.designerDateDelete('2026-04-20'))).not.toBeInTheDocument();

    // Added date gains papers: × disappears.
    await pickDate(user, '2026-04-23');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByTestId(ex.designerDateDelete('2026-04-23'))).toBeInTheDocument();
    view.rerender(
      <DatesheetDesigner {...PROPS} schedules={[paperOn('2026-04-20'), paperOn('2026-04-23')]} />,
    );
    expect(screen.queryByTestId(ex.designerDateDelete('2026-04-23'))).not.toBeInTheDocument();
  });

  it('should refuse a delete confirmed after papers land on the date', async () => {
    const user = userEvent.setup();
    const view = renderWithProviders(<DatesheetDesigner {...PROPS} />);

    await pickDate(user, '2026-04-23');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByTestId(ex.designerDateDelete('2026-04-23')));
    expect(screen.getByTestId(ex.designerDeleteDateDialog)).toBeInTheDocument();

    // Papers land while the confirm dialog is open.
    view.rerender(<DatesheetDesigner {...PROPS} schedules={[paperOn('2026-04-23')]} />);
    await user.click(screen.getByTestId(ex.designerDeleteDateConfirm));

    expect(screen.queryByTestId(ex.designerDeleteDateDialog)).not.toBeInTheDocument();
    expect(screen.getByText('23/04/2026')).toBeInTheDocument();
  });

  it('should shrink the range when deleting an empty edge day', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <DatesheetDesigner
        {...PROPS}
        startDate="2026-04-20"
        endDate="2026-04-23"
        schedules={[paperOn('2026-04-20')]}
      />,
    );

    // Middle days and paper days: no ×. Trailing empty edge: ×.
    expect(screen.queryByTestId(ex.designerDateDelete('2026-04-20'))).not.toBeInTheDocument();
    expect(screen.queryByTestId(ex.designerDateDelete('2026-04-21'))).not.toBeInTheDocument();
    expect(screen.queryByTestId(ex.designerDateDelete('2026-04-22'))).not.toBeInTheDocument();
    expect(screen.getByTestId(ex.designerDateDelete('2026-04-23'))).toBeInTheDocument();

    await user.click(screen.getByTestId(ex.designerDateDelete('2026-04-23')));
    expect(screen.getByText(/shrink to fit/)).toBeInTheDocument();
    await user.click(screen.getByTestId(ex.designerDeleteDateConfirm));

    expect(mocks.updateExam).toHaveBeenCalledWith('exam-1', { endDate: '2026-04-22' });
  });

  it('should offer no delete on a sole range day', () => {
    renderWithProviders(<DatesheetDesigner {...PROPS} />);

    expect(screen.queryByTestId(ex.designerDateDelete('2026-04-20'))).not.toBeInTheDocument();
  });

  it('should set both range ends when the exam has no dates at all', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DatesheetDesigner {...PROPS} startDate={null} endDate={null} />);

    // No columns: the picker opens on the current month — pick a visible
    // in-month day so the test never depends on navigation.
    const target = min([addDays(new Date(), 7), endOfMonth(new Date())]);
    await user.click(screen.getByTestId(ex.designerAddDateInput));
    await user.click(screen.getByRole('button', { name: dayLabel(target) }));
    await user.click(screen.getByRole('button', { name: 'Add' }));

    const iso = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
    expect(mocks.updateExam).toHaveBeenCalledWith('exam-1', {
      startDate: iso,
      endDate: iso,
    });
  });
});
