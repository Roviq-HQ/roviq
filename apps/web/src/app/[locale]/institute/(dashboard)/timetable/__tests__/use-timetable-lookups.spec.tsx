import { MockedProvider } from '@apollo/client/testing/react';
import { gql } from '@roviq/graphql';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TimetableLookupsProvider, useTimetableLookups } from '../use-timetable-lookups';

const standardsState: { standards: { id: string; name: Record<string, string> }[] } = {
  standards: [],
};

vi.mock('../../academics/use-academics', () => ({
  useStandards: () => ({ standards: standardsState.standards }),
}));

// Same documents as the hook's internal queries (matching is print-based).
const TEACHER_OPTIONS = gql`
  query TimetableTeacherOptions {
    teacherOptions {
      membershipId
      firstName
      lastName
    }
  }
`;

const SECTIONS_BY_YEAR = gql`
  query TimetableSectionsByYear($academicYearId: ID) {
    sectionsByAcademicYear(academicYearId: $academicYearId) {
      id
      name
      displayLabel
    }
  }
`;

const SUBJECTS_BY_YEAR = gql`
  query TimetableSubjectsByYear($academicYearId: ID) {
    subjectsByAcademicYear(academicYearId: $academicYearId) {
      id
      name
      standardId
    }
  }
`;

const teacherMocks = [
  {
    request: { query: TEACHER_OPTIONS },
    result: {
      data: {
        teacherOptions: [
          { membershipId: 'mem-1', firstName: { en: 'Rajesh' }, lastName: { en: 'Sharma' } },
          { membershipId: 'mem-2', firstName: { en: 'Aarav' }, lastName: null },
        ],
      },
    },
  },
];

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={{}}>
      <MockedProvider mocks={teacherMocks} addTypename={false}>
        {children}
      </MockedProvider>
    </NextIntlClientProvider>
  );
}

// Teacher names come from the names-only teacherOptions query (readable with
// Timetable read) — never listStaff, which 403s for teacher roles.
describe('useTimetableLookups teacher labels', () => {
  it('should resolve teacher names from the options query', async () => {
    const { result } = renderHook(() => useTimetableLookups(), { wrapper });

    await waitFor(() => expect(result.current.teacherOptions).toHaveLength(2));

    expect(result.current.teacherLabel('mem-1')).toBe('Rajesh Sharma');
    expect(result.current.teacherLabel('mem-2')).toBe('Aarav');
  });

  it('should fall back to the raw id for unknown teachers', async () => {
    const { result } = renderHook(() => useTimetableLookups(), { wrapper });

    await waitFor(() => expect(result.current.teacherOptions).toHaveLength(2));

    expect(result.current.teacherLabel('mem-gone')).toBe('mem-gone');
    expect(result.current.teacherLabel(null)).toBe('');
  });
});

function Probe() {
  const lookups = useTimetableLookups();
  return (
    <>
      <span>{lookups.sectionLabel('sec-1')}</span>
      <span>{lookups.subjectLabel('sub-1')}</span>
      <span>
        {lookups.subjectGroups.map((g) => `${g.standardLabel}:${g.options.length}`).join(',')}
      </span>
      <span>{lookups.subjectOptions.map((o) => o.value).join(',')}</span>
    </>
  );
}

// Sections/subjects resolve from two batched year queries — one request each,
// not one per standard.
describe('TimetableLookupsProvider maps', () => {
  beforeEach(() => {
    standardsState.standards = [{ id: 'std-1', name: { en: 'Class 5' } }];
  });

  it('should build section/subject labels and groups from batched queries', async () => {
    const mocks = [
      ...teacherMocks,
      {
        request: { query: SECTIONS_BY_YEAR, variables: { academicYearId: null } },
        result: {
          data: {
            sectionsByAcademicYear: [{ id: 'sec-1', name: { en: 'A' }, displayLabel: '5-A' }],
          },
        },
      },
      {
        request: { query: SUBJECTS_BY_YEAR, variables: { academicYearId: null } },
        result: {
          data: {
            subjectsByAcademicYear: [
              { id: 'sub-1', name: 'Mathematics', standardId: 'std-1' },
              { id: 'sub-2', name: 'Science', standardId: 'std-1' },
            ],
          },
        },
      },
    ];
    render(
      <NextIntlClientProvider locale="en" messages={{}}>
        <MockedProvider mocks={mocks} addTypename={false}>
          <TimetableLookupsProvider>
            <Probe />
          </TimetableLookupsProvider>
        </MockedProvider>
      </NextIntlClientProvider>,
    );

    // Sections and subjects resolve independently — wait for all three
    // async arrivals instead of racing the subjects response.
    await waitFor(() => {
      expect(screen.getByText('5-A')).toBeInTheDocument();
      expect(screen.getByText('Mathematics')).toBeInTheDocument();
      expect(screen.getByText('Class 5:2')).toBeInTheDocument();
    });
  });

  it('should list a multi-linked subject once in the flat options', async () => {
    standardsState.standards = [
      { id: 'std-1', name: { en: 'Class 5' } },
      { id: 'std-2', name: { en: 'Class 6' } },
    ];
    const mocks = [
      ...teacherMocks,
      {
        request: { query: SECTIONS_BY_YEAR, variables: { academicYearId: null } },
        result: { data: { sectionsByAcademicYear: [] } },
      },
      {
        request: { query: SUBJECTS_BY_YEAR, variables: { academicYearId: null } },
        result: {
          data: {
            subjectsByAcademicYear: [
              { id: 'sub-1', name: 'English', standardId: 'std-1' },
              { id: 'sub-1', name: 'English', standardId: 'std-2' },
            ],
          },
        },
      },
    ];
    render(
      <NextIntlClientProvider locale="en" messages={{}}>
        <MockedProvider mocks={mocks} addTypename={false}>
          <TimetableLookupsProvider>
            <Probe />
          </TimetableLookupsProvider>
        </MockedProvider>
      </NextIntlClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('Class 5:1,Class 6:1')).toBeInTheDocument());
    // Same subject in two groups, but the flat dropdown list holds it once.
    expect(screen.getByText('sub-1')).toBeInTheDocument();
  });
});
