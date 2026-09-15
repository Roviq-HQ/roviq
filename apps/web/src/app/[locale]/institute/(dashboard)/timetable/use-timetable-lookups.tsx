'use client';

/**
 * Builds id → display-name lookups + option lists for sections / subjects /
 * teachers used to render chips and dropdowns in the grid editor,
 * section/staff views, and day schedule.
 *
 * Three batched reads, no per-standard fan-out (one sections/subjects query
 * per standard used to fire 2N requests for N standards):
 *   - standards  → `standards`                 (year, for grouping labels)
 *   - sections   → `sectionsByAcademicYear`    (year)
 *   - subjects   → `subjectsByAcademicYear`    (year, tagged with standardId)
 *   - teachers   → `teacherOptions`            (institute-wide, names only —
 *     readable with Timetable read, unlike the Staff directory)
 *
 * Wrap a page subtree in `<TimetableLookupsProvider>` and read with
 * `useTimetableLookups()`. The year is optional: omitted means the active
 * year (pass an explicit id only when labeling a non-active year's entity,
 * like a historic timetable).
 */
import { gql, useQuery } from '@roviq/graphql';
import { useI18nField } from '@roviq/i18n';
import * as React from 'react';
import { useStandards } from '../academics/use-academics';

// Names-only staff list for labels/dropdowns. listStaff is NOT used here —
// teachers read timetables but not the staff directory, so that query 403s
// for exactly the users who need these labels most.
const STAFF_FOR_TIMETABLE = gql`
  query TimetableTeacherOptions {
    teacherOptions {
      membershipId
      firstName
      lastName
    }
  }
`;

const SECTIONS_FOR_TIMETABLE = gql`
  query TimetableSectionsByYear($academicYearId: ID) {
    sectionsByAcademicYear(academicYearId: $academicYearId) {
      id
      name
      displayLabel
    }
  }
`;

const SUBJECTS_FOR_TIMETABLE = gql`
  query TimetableSubjectsByYear($academicYearId: ID) {
    subjectsByAcademicYear(academicYearId: $academicYearId) {
      id
      name
      standardId
    }
  }
`;

interface StaffLite {
  membershipId: string;
  firstName: Record<string, string>;
  lastName: Record<string, string> | null;
}

interface SectionLite {
  id: string;
  name: Record<string, string>;
  displayLabel: string | null;
}

interface SubjectLite {
  id: string;
  name: string;
  standardId: string;
}

export interface TimetableOption {
  value: string;
  label: string;
}

interface SubjectGroup {
  standardId: string;
  standardLabel: string;
  options: TimetableOption[];
}

interface LookupsContextValue {
  sectionLabels: Map<string, string>;
  subjectLabels: Map<string, string>;
  subjectGroups: SubjectGroup[];
}

const LookupsContext = React.createContext<LookupsContextValue | null>(null);

export interface TimetableLookups {
  sectionLabel: (id: string | null | undefined) => string;
  subjectLabel: (id: string | null | undefined) => string;
  teacherLabel: (id: string | null | undefined) => string;
  subjectGroups: SubjectGroup[];
  subjectOptions: TimetableOption[];
  teacherOptions: TimetableOption[];
  loading: boolean;
}

export function TimetableLookupsProvider({
  academicYearId,
  children,
}: {
  academicYearId?: string | null;
  children: React.ReactNode;
}) {
  const resolveI18n = useI18nField();
  const { standards } = useStandards(academicYearId);
  const { data: sectionsData } = useQuery<{ sectionsByAcademicYear: SectionLite[] }>(
    SECTIONS_FOR_TIMETABLE,
    { variables: { academicYearId: academicYearId ?? null } },
  );
  const { data: subjectsData } = useQuery<{ subjectsByAcademicYear: SubjectLite[] }>(
    SUBJECTS_FOR_TIMETABLE,
    { variables: { academicYearId: academicYearId ?? null } },
  );

  const value = React.useMemo<LookupsContextValue>(() => {
    const sectionLabels = new Map<string, string>();
    for (const section of sectionsData?.sectionsByAcademicYear ?? []) {
      sectionLabels.set(section.id, section.displayLabel ?? resolveI18n(section.name));
    }

    const standardName = new Map(standards.map((s) => [s.id, s.name]));
    const subjectLabels = new Map<string, string>();
    const groups = new Map<string, SubjectGroup>();
    for (const subject of subjectsData?.subjectsByAcademicYear ?? []) {
      const label = resolveI18n(subject.name);
      subjectLabels.set(subject.id, label);
      const group = groups.get(subject.standardId) ?? {
        standardId: subject.standardId,
        standardLabel: resolveI18n(standardName.get(subject.standardId) ?? {}),
        options: [],
      };
      group.options.push({ value: subject.id, label });
      groups.set(subject.standardId, group);
    }

    return { sectionLabels, subjectLabels, subjectGroups: Array.from(groups.values()) };
  }, [sectionsData, subjectsData, standards, resolveI18n]);

  return <LookupsContext.Provider value={value}>{children}</LookupsContext.Provider>;
}

export function useTimetableLookups(): TimetableLookups {
  const ctx = React.useContext(LookupsContext);
  const resolveI18n = useI18nField();
  const { data, loading } = useQuery<{ teacherOptions: StaffLite[] }>(STAFF_FOR_TIMETABLE);

  return React.useMemo(() => {
    const teacherLabels = new Map<string, string>();
    const teacherOptions: TimetableOption[] = (data?.teacherOptions ?? []).map((m) => {
      const label = `${resolveI18n(m.firstName)} ${resolveI18n(m.lastName ?? {})}`.trim();
      teacherLabels.set(m.membershipId, label);
      return { value: m.membershipId, label };
    });
    // A subject linked to N standards appears in N groups — flattening for a
    // single dropdown must dedupe, or keys collide and React drops options.
    const subjectOptions = Array.from(
      new Map(
        (ctx?.subjectGroups ?? []).flatMap((g) => g.options).map((o) => [o.value, o] as const),
      ).values(),
    );
    return {
      sectionLabel: (id) => (id ? (ctx?.sectionLabels.get(id) ?? id) : ''),
      subjectLabel: (id) => (id ? (ctx?.subjectLabels.get(id) ?? id) : ''),
      teacherLabel: (id) => (id ? (teacherLabels.get(id) ?? id) : ''),
      subjectGroups: ctx?.subjectGroups ?? [],
      subjectOptions,
      teacherOptions,
      loading,
    };
  }, [ctx, data, resolveI18n, loading]);
}
