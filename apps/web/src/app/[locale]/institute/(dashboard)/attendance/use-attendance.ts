'use client';

import { gql, useMutation, useQuery } from '@roviq/graphql';
import type {
  AbsenteeReportItem,
  AttendanceDateSummary,
  AttendanceEntryModel,
  AttendanceSectionOption,
  AttendanceSessionModel,
  AttendanceStatus,
  AttendanceStatusCount,
  SectionDailyBreakdown,
  StudentHistoryItem,
  StudentModel,
} from '@roviq/graphql/generated';

// ── Fragments / queries ────────────────────────────────────────────────

const SESSIONS_FOR_SECTION = gql`
  query AttendanceSessionsForSection($sectionId: ID!, $startDate: String!, $endDate: String!) {
    attendanceSessionsForSection(sectionId: $sectionId, startDate: $startDate, endDate: $endDate) {
      id
      sectionId
      academicYearId
      date
      period
      subjectId
      lecturerId
      overrideCheck
      createdAt
      updatedAt
    }
  }
`;

const SESSION_ENTRIES = gql`
  query AttendanceEntries($sessionId: ID!) {
    attendanceEntries(sessionId: $sessionId) {
      id
      sessionId
      studentId
      status
      mode
      remarks
      markedAt
    }
  }
`;

const SESSION_COUNTS = gql`
  query AttendanceCounts($sessionId: ID!) {
    attendanceCounts(sessionId: $sessionId) {
      status
      count
    }
  }
`;

const DATE_COUNTS = gql`
  query AttendanceCountsForDate($date: String!, $sectionId: ID, $academicYearId: ID) {
    attendanceCountsForDate(date: $date, sectionId: $sectionId, academicYearId: $academicYearId) {
      sessionCount
      studentCount
      counts {
        status
        count
      }
    }
  }
`;

const ATTENDANCE_SECTIONS = gql`
  query AttendanceSections($academicYearId: ID!) {
    attendanceSections(academicYearId: $academicYearId) {
      id
      name
      displayLabel
      standardId
      standardName
      classTeacherId
    }
  }
`;

const OPEN_SESSION = gql`
  mutation OpenAttendanceSession($input: CreateAttendanceSessionInput!) {
    openAttendanceSession(input: $input) {
      id
      sectionId
      academicYearId
      date
      period
      subjectId
      lecturerId
    }
  }
`;

const MARK_ATTENDANCE = gql`
  mutation MarkAttendance($input: MarkAttendanceInput!) {
    markAttendance(input: $input) {
      id
      sessionId
      studentId
      status
      mode
      remarks
      markedAt
    }
  }
`;

const BULK_MARK = gql`
  mutation BulkMarkAttendance($input: BulkMarkAttendanceInput!) {
    bulkMarkAttendance(input: $input) {
      id
      studentId
      status
    }
  }
`;

const LIST_STUDENTS_IN_SECTION = gql`
  query StudentsInSection($sectionId: ID!, $academicYearId: ID!) {
    listStudents(filter: { sectionId: $sectionId, academicYearId: $academicYearId, first: 1000 }) {
      edges {
        node {
          id
          membershipId
          firstName
          lastName
          admissionNumber
          profileImage {
            id
            url(variant: SM)
            placeholder
          }
        }
      }
    }
  }
`;

// ── Types ────────────────────────────────────────────────────────────

export type {
  AbsenteeReportItem,
  AttendanceDateSummary,
  AttendanceSectionOption,
  AttendanceStatus,
  SectionDailyBreakdown,
  StudentHistoryItem,
};
export type AttendanceSession = AttendanceSessionModel;
export type AttendanceEntry = AttendanceEntryModel;
export type StatusCount = AttendanceStatusCount;
export type SectionStudent = Pick<
  StudentModel,
  'id' | 'membershipId' | 'firstName' | 'lastName' | 'admissionNumber' | 'profileImage'
> & { membershipId: string };

// ── Hooks ────────────────────────────────────────────────────────────

export function useSessionsForSection(
  sectionId: string | null,
  startDate: string,
  endDate: string,
) {
  const { data, loading, refetch } = useQuery<{
    attendanceSessionsForSection: AttendanceSession[];
  }>(SESSIONS_FOR_SECTION, {
    variables: { sectionId, startDate, endDate },
    skip: !sectionId,
  });
  return { sessions: data?.attendanceSessionsForSection ?? [], loading, refetch };
}

export function useSessionEntries(sessionId: string | null) {
  const { data, loading, refetch } = useQuery<{ attendanceEntries: AttendanceEntry[] }>(
    SESSION_ENTRIES,
    { variables: { sessionId }, skip: !sessionId },
  );
  return { entries: data?.attendanceEntries ?? [], loading, refetch };
}

export function useSessionCounts(sessionId: string | null) {
  const { data } = useQuery<{ attendanceCounts: StatusCount[] }>(SESSION_COUNTS, {
    variables: { sessionId },
    skip: !sessionId,
    pollInterval: 15000,
  });
  return { counts: data?.attendanceCounts ?? [] };
}

/**
 * Totals for one date. The server limits them to the caller's authorized
 * sections; pass a section/year to narrow further.
 */
export function useDateSummary(options: {
  date: string;
  sectionId: string | null;
  academicYearId: string | null;
  skip: boolean;
}) {
  const { date, sectionId, academicYearId, skip } = options;
  const { data, loading } = useQuery<{ attendanceCountsForDate: AttendanceDateSummary }>(
    DATE_COUNTS,
    { variables: { date, sectionId, academicYearId }, skip },
  );
  return { summary: skip ? null : (data?.attendanceCountsForDate ?? null), loading };
}

export function useAttendanceSections(academicYearId: string | null) {
  const { data, loading } = useQuery<{ attendanceSections: AttendanceSectionOption[] }>(
    ATTENDANCE_SECTIONS,
    { variables: { academicYearId }, skip: !academicYearId },
  );
  return { sections: data?.attendanceSections ?? [], loading };
}

export function useOpenSession() {
  const [mutate, { loading }] = useMutation(OPEN_SESSION, {
    refetchQueries: ['AttendanceSessionsForSection', 'AttendanceCountsForDate'],
  });
  return {
    openSession: (input: {
      sectionId: string;
      academicYearId: string;
      date: string;
      period?: number | null;
      subjectId?: string | null;
      lecturerId: string;
    }) => mutate({ variables: { input } }),
    loading,
  };
}

export function useMarkAttendance() {
  const [mutate, { loading }] = useMutation(MARK_ATTENDANCE, {
    refetchQueries: ['AttendanceEntries', 'AttendanceCounts', 'AttendanceCountsForDate'],
  });
  return {
    mark: (input: {
      sessionId: string;
      studentId: string;
      status: AttendanceStatus;
      remarks?: string | null;
    }) => mutate({ variables: { input } }),
    loading,
  };
}

export function useBulkMarkAttendance() {
  const [mutate, { loading }] = useMutation(BULK_MARK, {
    refetchQueries: ['AttendanceEntries', 'AttendanceCounts', 'AttendanceCountsForDate'],
  });
  return {
    bulkMark: (
      sessionId: string,
      entries: Array<{ studentId: string; status: AttendanceStatus }>,
    ) => mutate({ variables: { input: { sessionId, entries } } }),
    loading,
  };
}

/** Roster of a section in a given academic year (the list API defaults to the active year). */
export function useStudentsInSection(sectionId: string | null, academicYearId: string | null) {
  const { data, loading } = useQuery<{
    listStudents: {
      edges: Array<{
        node: Omit<SectionStudent, 'membershipId'> & { membershipId: string | null };
      }>;
    };
  }>(LIST_STUDENTS_IN_SECTION, {
    variables: { sectionId, academicYearId },
    skip: !sectionId || !academicYearId,
  });
  return {
    students: (data?.listStudents.edges.map((e) => e.node) ?? []).filter(
      (student): student is SectionStudent & { membershipId: string } =>
        typeof student.membershipId === 'string',
    ),
    loading,
  };
}

// ── Reports ──────────────────────────────────────────────────────────

const ABSENTEES_REPORT = gql`
  query AttendanceAbsenteesReport(
    $sectionId: ID
    $standardId: ID
    $startDate: String!
    $endDate: String!
  ) {
    attendanceAbsenteesReport(
      sectionId: $sectionId
      standardId: $standardId
      startDate: $startDate
      endDate: $endDate
    ) {
      studentId
      totalSessions
      presentCount
      absentCount
      leaveCount
      lateCount
      absentDates
    }
  }
`;

const SECTION_DAILY_BREAKDOWN = gql`
  query AttendanceSectionDailyBreakdown($date: String!, $standardId: ID) {
    attendanceSectionDailyBreakdown(date: $date, standardId: $standardId) {
      sectionId
      sectionName
      period
      subjectId
      lecturerId
      presentCount
      absentCount
      leaveCount
      lateCount
      absenteeIds
    }
  }
`;

/**
 * Absentee report aggregated per-student for the given date range. Null
 * section and standard cover all of the caller's authorized sections.
 */
export function useAbsenteesReport(options: {
  sectionId: string | null;
  standardId: string | null;
  startDate: string;
  endDate: string;
  skip: boolean;
}) {
  const { sectionId, standardId, startDate, endDate, skip } = options;
  const { data, loading, error, refetch } = useQuery<{
    attendanceAbsenteesReport: AbsenteeReportItem[];
  }>(ABSENTEES_REPORT, {
    variables: { sectionId, standardId, startDate, endDate },
    skip: skip || !startDate || !endDate,
  });
  return {
    rows: skip ? [] : (data?.attendanceAbsenteesReport ?? []),
    loading,
    error,
    refetch,
  };
}

/**
 * Section-level counts for every attendance session on a single date.
 * Used by the "Daily breakdown" reports tab — the backend returns one
 * row per (section, period) pair so a class taking multiple periods on
 * the same day renders as several rows.
 */
export function useSectionDailyBreakdown(options: {
  date: string;
  standardId: string | null;
  skip: boolean;
}) {
  const { date, standardId, skip } = options;
  const { data, loading, error, refetch } = useQuery<{
    attendanceSectionDailyBreakdown: SectionDailyBreakdown[];
  }>(SECTION_DAILY_BREAKDOWN, {
    variables: { date, standardId },
    skip: skip || !date,
  });
  return {
    rows: skip ? [] : (data?.attendanceSectionDailyBreakdown ?? []),
    loading,
    error,
    refetch,
  };
}

// ── Override + student history ────────────────────────────────────────

const OVERRIDE_SESSION = gql`
  mutation OverrideAttendanceSession($sessionId: ID!, $lecturerId: ID!, $subjectId: ID) {
    overrideAttendanceSession(
      sessionId: $sessionId
      lecturerId: $lecturerId
      subjectId: $subjectId
    ) {
      id
      lecturerId
      subjectId
    }
  }
`;

const STUDENT_HISTORY = gql`
  query AttendanceStudentHistory($studentId: ID!, $startDate: String!, $endDate: String!) {
    attendanceStudentHistory(studentId: $studentId, startDate: $startDate, endDate: $endDate) {
      sessionId
      sectionId
      date
      period
      subjectId
      status
      remarks
      markedAt
    }
  }
`;

export function useOverrideSession() {
  const [mutate, { loading }] = useMutation(OVERRIDE_SESSION, {
    refetchQueries: ['AttendanceSessionsForSection'],
  });
  return {
    override: (input: { sessionId: string; lecturerId: string; subjectId?: string | null }) =>
      mutate({ variables: input }),
    loading,
  };
}

export function useStudentHistory(studentId: string | null, startDate: string, endDate: string) {
  const { data, loading, error, refetch } = useQuery<{
    attendanceStudentHistory: StudentHistoryItem[];
  }>(STUDENT_HISTORY, {
    variables: { studentId, startDate, endDate },
    skip: !studentId || !startDate || !endDate,
  });
  return {
    rows: data?.attendanceStudentHistory ?? [],
    loading,
    error,
    refetch,
  };
}
