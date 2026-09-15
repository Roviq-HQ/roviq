import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { describe, expect, it, vi } from 'vitest';
import TimetableEditorPage from '../page';

const { instituteTimetable } = testIds;

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en', timetableId: 'tt-1' }),
}));

vi.mock('../../use-timetable', () => ({
  useTimetable: () => ({
    timetable: {
      id: 'tt-1',
      academicYearId: 'ay-1',
      name: { en: 'Weekly' },
      status: 'DRAFT',
      sections: [{ sectionId: 'sec-1' }],
      periods: [
        {
          id: 'per-1',
          kind: 'PERIOD',
          label: 'P1',
          sequence: 1,
          startTime: '08:00:00',
          endTime: '08:45:00',
          session: 'MORNING',
        },
      ],
      workingDays: ['MONDAY'],
      defaultPeriodDurationMins: 45,
    },
    loading: false,
  }),
  useSectionTimetable: () => ({
    grid: {
      timetableId: 'tt-1',
      teacherName: null,
      periods: [],
      workingDays: [],
      entries: [
        {
          id: 'e-1',
          periodId: 'per-1',
          sectionId: 'sec-1',
          dayOfWeek: 'MONDAY',
          splitIndex: 0,
          splitLabel: null,
          subjectId: 'sub-1',
          teacherId: null,
          room: null,
        },
      ],
    },
    loading: false,
  }),
  useRemoveTimetablePeriod: () => ({ removePeriod: vi.fn(), loading: false }),
  useUpdateTimetableStatus: () => ({ updateStatus: vi.fn(), loading: false }),
  useAddTimetablePeriod: () => ({ addPeriod: vi.fn(), loading: false }),
  useAssignTimetableEntry: () => ({ assignEntry: vi.fn(), loading: false }),
  useClearTimetableEntry: () => ({ clearEntry: vi.fn(), loading: false }),
}));

vi.mock('../../use-timetable-lookups', () => ({
  TimetableLookupsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTimetableLookups: () => ({
    sectionLabel: () => 'Sec A',
    subjectLabel: () => 'Maths',
    teacherLabel: () => '',
    subjectGroups: [],
    subjectOptions: [],
    teacherOptions: [],
    loading: false,
  }),
}));

const READ_ONLY_RULES = [{ action: 'read', subject: 'Timetable' }] as const;
const EDITOR_RULES = [
  { action: 'read', subject: 'Timetable' },
  { action: 'update', subject: 'Timetable' },
] as const;

// Grid cells open the assign dialog — but only for roles allowed to alter
// the timetable (assign/clear both enforce update:Timetable server-side).
describe('editor grid cell gating', () => {
  it('should render cells as plain content without update rights', () => {
    renderWithProviders(<TimetableEditorPage />, { abilityRules: [...READ_ONLY_RULES] });

    const cell = screen.getByTestId(instituteTimetable.gridCell('per-1', 'MONDAY'));
    expect(cell.tagName).toBe('DIV');
    expect(cell).toHaveTextContent('Maths');
    expect(screen.queryByText('+')).not.toBeInTheDocument();
  });

  it('should not open the assign dialog when read-only cells are clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TimetableEditorPage />, { abilityRules: [...READ_ONLY_RULES] });

    await user.click(screen.getByTestId(instituteTimetable.gridCell('per-1', 'MONDAY')));

    expect(screen.queryByTestId(instituteTimetable.assignDialog)).not.toBeInTheDocument();
  });

  it('should render clickable cells with update rights', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TimetableEditorPage />, { abilityRules: [...EDITOR_RULES] });

    const cell = screen.getByTestId(instituteTimetable.gridCell('per-1', 'MONDAY'));
    expect(cell.tagName).toBe('BUTTON');

    await user.click(cell);
    expect(screen.getByTestId(instituteTimetable.assignDialog)).toBeInTheDocument();
  });
});

// Section tabs resolve their default selection asynchronously: the Tabs must
// stay controlled from the first render instead of flipping uncontrolled →
// controlled once the default section arrives (React warning at tabs.tsx:14).
describe('editor section tabs', () => {
  it('should not warn about controlled/uncontrolled switching', async () => {
    // React warns via console.error, Radix via console.warn — cover both.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      renderWithProviders(<TimetableEditorPage />, { abilityRules: [...EDITOR_RULES] });
      expect(await screen.findByRole('tab', { name: 'Sec A' })).toBeInTheDocument();

      const switches = [...errorSpy.mock.calls, ...warnSpy.mock.calls].filter((call) =>
        call.some((arg) =>
          /controlled to uncontrolled|uncontrolled to controlled/.test(String(arg)),
        ),
      );
      expect(switches).toHaveLength(0);
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
