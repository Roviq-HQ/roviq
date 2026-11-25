/**
 * Component tests for the attendance reports page: absentees and the daily
 * breakdown show the names the API joins in, with translated fallbacks.
 */
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../../../../../__test-utils__/render-with-providers';

const QUERY_STATE: Record<string, unknown> = {};
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/en/institute/attendance/reports',
}));

vi.mock('nuqs', () => ({
  parseAsString: {
    withDefault: (defaultValue: string) => ({ defaultValue }),
  },
  useQueryState: (key: string, parser?: { defaultValue?: unknown }) => [
    key in QUERY_STATE ? QUERY_STATE[key] : (parser?.defaultValue ?? null),
    vi.fn().mockResolvedValue(null),
  ],
}));

vi.mock('../../../academic-years/use-academic-years', () => ({
  useAcademicYears: () => ({ years: [{ id: 'year-1', status: 'ACTIVE' }] }),
}));

vi.mock('../../use-attendance-scope', () => ({
  useAttendanceScope: () => ({
    standardId: null,
    sectionId: null,
    standards: [],
    sectionsForStandard: [],
    sections: [],
    allowAllStandards: true,
    allowAllSections: true,
    ready: true,
    noAssignments: false,
  }),
}));

const downloadCsv = vi.fn();
vi.mock('@web/lib/csv', () => ({
  buildCsv: (headers: string[], body: (string | number)[][]) => ({ headers, body }),
  downloadCsv: (...args: unknown[]) => downloadCsv(...args),
}));

const MEMBER_A = '01a2b3c4-0000-7000-8000-00000000000a';
const MEMBER_B = '01a2b3c4-0000-7000-8000-00000000000b';
const SECTION = '01a2b3c4-0000-7000-8000-0000000000c1';

const reportRows = [
  {
    studentId: MEMBER_A,
    studentFirstName: { en: 'Aarav', hi: 'आरव' },
    studentLastName: { en: 'Sharma', hi: 'शर्मा' },
    admissionNumber: 'ADM-0042',
    totalSessions: 4,
    presentCount: 3,
    absentCount: 1,
    leaveCount: 0,
    lateCount: 0,
    absentDates: ['2026-05-04'],
  },
  {
    studentId: MEMBER_B,
    studentFirstName: null,
    studentLastName: null,
    admissionNumber: null,
    totalSessions: 4,
    presentCount: 2,
    absentCount: 2,
    leaveCount: 0,
    lateCount: 0,
    absentDates: ['2026-05-04', '2026-05-05'],
  },
];

const breakdownRows = [
  {
    sectionId: SECTION,
    sectionName: null,
    period: null,
    subjectId: null,
    lecturerId: 'lect-1',
    lecturerFirstName: { en: 'Kavita', hi: 'कविता' },
    lecturerLastName: { en: 'Rao', hi: 'राव' },
    presentCount: 1,
    absentCount: 2,
    leaveCount: 0,
    lateCount: 0,
    absenteeIds: [MEMBER_A, MEMBER_B],
    absentees: [
      {
        studentId: MEMBER_A,
        firstName: { en: 'Aarav', hi: 'आरव' },
        lastName: { en: 'Sharma', hi: 'शर्मा' },
        admissionNumber: 'ADM-0042',
      },
      { studentId: MEMBER_B, firstName: null, lastName: null, admissionNumber: null },
    ],
  },
];

vi.mock('../../use-attendance', () => ({
  useAbsenteesReport: () => ({
    rows: reportRows,
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
  useSectionDailyBreakdown: () => ({
    rows: breakdownRows,
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
}));

import AttendanceReportsPage from '../page';

const { instituteAttendance } = testIds;

describe('AttendanceReportsPage names (ROV-360)', () => {
  beforeEach(() => {
    for (const key of Object.keys(QUERY_STATE)) delete QUERY_STATE[key];
    downloadCsv.mockClear();
  });

  it('shows absentees by name and admission number, in Hindi too', () => {
    renderWithProviders(<AttendanceReportsPage />, { locale: 'hi' });
    expect(screen.getByTestId(`absentees-row-${MEMBER_A}-name`)).toHaveTextContent('आरव शर्मा');
    expect(screen.getByText('ADM-0042')).toBeInTheDocument();
  });

  it('says "Unknown student", never a shortened id, for an unreadable student', () => {
    renderWithProviders(<AttendanceReportsPage />);
    const cell = screen.getByTestId(`absentees-row-${MEMBER_B}-name`);
    expect(cell).toHaveTextContent('Unknown student');
    expect(document.body).not.toHaveTextContent(MEMBER_B.slice(0, 8));
  });

  it('exports absentees with names', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AttendanceReportsPage />);
    await user.click(screen.getByTestId(instituteAttendance.absenteesExportCsvBtn));
    const [, csv] = downloadCsv.mock.calls[0] as [string, { body: (string | number)[][] }];
    expect(csv.body[0][0]).toBe('Aarav Sharma (ADM-0042)');
    expect(csv.body[1][0]).toBe('Unknown student (—)');
  });

  it('names absentees in the daily breakdown, with fallbacks for an unknown student and section', () => {
    QUERY_STATE.tab = 'daily';
    renderWithProviders(<AttendanceReportsPage />);
    expect(screen.getByTestId(`breakdown-absentee-${MEMBER_A}`)).toHaveTextContent(
      'Aarav Sharma (ADM-0042)',
    );
    expect(screen.getByTestId(`breakdown-absentee-${MEMBER_B}`)).toHaveTextContent(
      'Unknown student',
    );
    const table = screen.getByTestId(instituteAttendance.breakdownTable);
    expect(table).toHaveTextContent('Unknown section');
    expect(table).not.toHaveTextContent(SECTION.slice(0, 8));
    expect(table).not.toHaveTextContent(MEMBER_B.slice(0, 8));
  });

  it('exports the daily breakdown with the lecturer and absentee names', async () => {
    QUERY_STATE.tab = 'daily';
    const user = userEvent.setup();
    renderWithProviders(<AttendanceReportsPage />, { locale: 'hi' });
    await user.click(screen.getByTestId(instituteAttendance.dailyExportCsvBtn));
    const [, csv] = downloadCsv.mock.calls[0] as [string, { body: (string | number)[][] }];
    expect(csv.body[0][2]).toBe('कविता राव');
    expect(csv.body[0][7]).toBe('आरव शर्मा (ADM-0042);अज्ञात छात्र');
  });
});
