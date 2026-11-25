/**
 * Component tests for the Attendance History page.
 *
 * Mocks `next/navigation`, `nuqs`, `useStudents`, and the attendance `useStudentHistory`
 * hook. Three cases cover the pre-pick empty state, the populated table + summary
 * strip, and the row-level testIds.
 */
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../../../../../__test-utils__/render-with-providers';

// Per-key overrides let individual tests drive the `studentId` query param —
// the page gates the summary + table on a non-null studentId.
const QUERY_STATE_OVERRIDES: Record<string, unknown> = {};
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/en/institute/attendance/history',
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
  notFound: vi.fn(),
  RedirectType: { push: 'push', replace: 'replace' },
}));

vi.mock('nuqs', () => ({
  parseAsString: {
    withDefault: (defaultValue: string) => ({ __kind: 'string', defaultValue }),
  },
  parseAsInteger: {
    withDefault: (defaultValue: number) => ({ __kind: 'integer', defaultValue }),
  },
  useQueryState: (key: string, parser?: { defaultValue?: unknown }) => {
    if (key in QUERY_STATE_OVERRIDES) {
      return [QUERY_STATE_OVERRIDES[key], vi.fn().mockResolvedValue(null)];
    }
    return [
      parser && 'defaultValue' in parser ? (parser.defaultValue as unknown) : null,
      vi.fn().mockResolvedValue(null),
    ];
  },
}));

// Students the picker can find by membership id; the lookup is what shows the
// chosen student's name, so it must not depend on the search page.
const studentsState: {
  byMembership: Record<
    string,
    {
      firstName: Record<string, string>;
      lastName: Record<string, string> | null;
      admissionNumber: string;
    }
  >;
  loading: boolean;
} = { byMembership: {}, loading: false };
vi.mock('../../../people/students/use-students', () => ({
  useStudents: (filter?: { membershipId?: string }) => {
    const found = filter?.membershipId
      ? studentsState.byMembership[filter.membershipId]
      : undefined;
    return {
      students: found ? [{ membershipId: filter?.membershipId, ...found }] : [],
      totalCount: found ? 1 : 0,
      hasNextPage: false,
      loading: filter?.membershipId ? studentsState.loading : false,
      loadMore: vi.fn(),
      refetch: vi.fn(),
    };
  },
}));

interface HistoryRowFixture {
  sessionId: string;
  sectionId: string;
  date: string;
  period: number | null;
  subjectId: string | null;
  status: 'PRESENT' | 'ABSENT' | 'LEAVE' | 'LATE';
  remarks: string | null;
  markedAt: string;
}
const hookState: { rows: HistoryRowFixture[] } = { rows: [] };

vi.mock('../../use-attendance', () => ({
  useStudentHistory: () => ({
    rows: hookState.rows,
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
}));

// Import AFTER mocks.
import AttendanceHistoryPage from '../page';

describe('AttendanceHistoryPage', () => {
  it('renders the "pick a student" empty-state when no studentId is selected', () => {
    for (const key of Object.keys(QUERY_STATE_OVERRIDES)) delete QUERY_STATE_OVERRIDES[key];
    renderWithProviders(<AttendanceHistoryPage />);
    expect(screen.getByTestId('attendance-history-title')).toBeInTheDocument();
    expect(
      screen.getByText('Choose a student to view their attendance history.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('history-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('history-table')).not.toBeInTheDocument();
  });

  it('renders the summary strip + table once a student is picked and rows are returned', () => {
    QUERY_STATE_OVERRIDES.studentId = 'stu-1';
    hookState.rows = [
      {
        sessionId: 'sess-1',
        sectionId: 'sec-1',
        date: '2026-04-10',
        period: 1,
        subjectId: 'sub-math',
        status: 'PRESENT',
        remarks: null,
        markedAt: '2026-04-10T09:00:00Z',
      },
      {
        sessionId: 'sess-1',
        sectionId: 'sec-1',
        date: '2026-04-10',
        period: 2,
        subjectId: 'sub-eng',
        status: 'ABSENT',
        remarks: 'Sick',
        markedAt: '2026-04-10T10:00:00Z',
      },
    ];
    renderWithProviders(<AttendanceHistoryPage />);
    expect(screen.getByTestId('history-summary')).toBeInTheDocument();
    expect(screen.getByTestId('history-summary-PRESENT')).toHaveTextContent('Present: 1');
    expect(screen.getByTestId('history-summary-ABSENT')).toHaveTextContent('Absent: 1');
    expect(screen.getByTestId('history-table')).toBeInTheDocument();
  });

  it('emits the expected row-level testIds for each returned history item', () => {
    QUERY_STATE_OVERRIDES.studentId = 'stu-1';
    hookState.rows = [
      {
        sessionId: 'sess-1',
        sectionId: 'sec-1',
        date: '2026-04-10',
        period: 1,
        subjectId: null,
        status: 'LATE',
        remarks: null,
        markedAt: '2026-04-10T09:00:00Z',
      },
    ];
    renderWithProviders(<AttendanceHistoryPage />);
    // Row key is `${sessionId}-${date}-${period ?? 'day'}`.
    const rowKey = 'sess-1-2026-04-10-1';
    const dateCell = screen.getByTestId(`history-row-${rowKey}-date`);
    const statusCell = screen.getByTestId(`history-row-${rowKey}-status`);
    expect(dateCell).toBeInTheDocument();
    expect(statusCell).toHaveTextContent('Late');
    // Row key scope-check: the cells sit inside the history table.
    const table = screen.getByTestId('history-table');
    expect(within(table).getByTestId(`history-row-${rowKey}-date`)).toBeInTheDocument();
  });

  describe('"Who was notified" link', () => {
    const row: HistoryRowFixture = {
      sessionId: 'sess-9',
      sectionId: 'sec-1',
      date: '2026-04-11',
      period: null,
      subjectId: null,
      status: 'ABSENT',
      remarks: null,
      markedAt: '2026-04-11T09:00:00Z',
    };
    const link = testIds.notificationDelivery.sessionLink('sess-9-2026-04-11-day');

    it('opens the delivery page filtered to the row session', () => {
      QUERY_STATE_OVERRIDES.studentId = 'stu-1';
      hookState.rows = [row];
      renderWithProviders(<AttendanceHistoryPage />);
      expect(screen.getByTestId(link)).toHaveAttribute(
        'href',
        expect.stringContaining('/institute/settings/notifications/delivery?sessionId=sess-9'),
      );
    });

    it('is not shown without the delivery read ability', () => {
      QUERY_STATE_OVERRIDES.studentId = 'stu-1';
      hookState.rows = [row];
      renderWithProviders(<AttendanceHistoryPage />, {
        abilityRules: [{ action: 'read', subject: 'Attendance' }],
      });
      expect(screen.getByTestId('history-table')).toBeInTheDocument();
      expect(screen.queryByTestId(link)).not.toBeInTheDocument();
    });
  });

  describe('chosen student label (ROV-360)', () => {
    const picker = testIds.instituteAttendance.historyStudentPicker;

    it('shows the name and admission number, in Hindi too', () => {
      QUERY_STATE_OVERRIDES.studentId = '01a2b3c4-0000-7000-8000-000000000001';
      hookState.rows = [];
      studentsState.byMembership = {
        '01a2b3c4-0000-7000-8000-000000000001': {
          firstName: { en: 'Aarav', hi: 'आरव' },
          lastName: { en: 'Sharma', hi: 'शर्मा' },
          admissionNumber: 'ADM-0042',
        },
      };
      renderWithProviders(<AttendanceHistoryPage />, { locale: 'hi' });
      expect(screen.getByTestId(picker)).toHaveTextContent('आरव शर्मा · ADM-0042');
    });

    it('says "Unknown student", never a shortened id, when the student is not found', () => {
      QUERY_STATE_OVERRIDES.studentId = '01a2b3c4-0000-7000-8000-000000000002';
      studentsState.byMembership = {};
      renderWithProviders(<AttendanceHistoryPage />);
      const button = screen.getByTestId(picker);
      expect(button).toHaveTextContent('Unknown student');
      expect(button).not.toHaveTextContent('01a2b3c4');
    });

    it('shows neither a fallback nor an id while the student loads', () => {
      QUERY_STATE_OVERRIDES.studentId = '01a2b3c4-0000-7000-8000-000000000003';
      studentsState.loading = true;
      renderWithProviders(<AttendanceHistoryPage />);
      const button = screen.getByTestId(picker);
      expect(button).not.toHaveTextContent('Unknown student');
      expect(button).not.toHaveTextContent('01a2b3c4');
      studentsState.loading = false;
    });
  });
});
