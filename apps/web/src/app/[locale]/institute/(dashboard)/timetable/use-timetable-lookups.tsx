'use client';

/**
 * Builds id → display-name lookups + option lists for sections / subjects /
 * teachers used to render chips and dropdowns in the grid editor,
 * section/staff views, and day schedule.
 *
 * These reuse EXISTING backend queries — the timetable feature does not own
 * sections/subjects/teachers, so we never invent new queries for them:
 *   - sections        → `sections(standardId)`        (per standard)
 *   - subjects        → `subjectsByStandard(standardId)` (per standard)
 *   - teachers (staff)→ `listStaff(filter)`            (institute-wide)
 *
 * Sections/subjects are per-standard queries, so we fan out one query per
 * standard through `<StandardLoader>` child components (hooks can't loop) and
 * register results into a shared map exposed via context. Wrap a page subtree
 * in `<TimetableLookupsProvider academicYearId={…}>` and read with
 * `useTimetableLookups()`.
 */
import { gql, useQuery } from '@roviq/graphql';
import { useI18nField } from '@roviq/i18n';
import * as React from 'react';
import { useSections, useStandards, useSubjectsByStandard } from '../academics/use-academics';

// `first` is capped at 100 by the listStaff resolver; 100 covers a single
// institute's teaching staff for label lookups (subject/section/teacher names).
const STAFF_FOR_TIMETABLE = gql`
  query TimetableStaff {
    listStaff(filter: { first: 100 }) {
      membershipId
      firstName
      lastName
    }
  }
`;

interface StaffLite {
  membershipId: string;
  firstName: Record<string, string>;
  lastName: Record<string, string> | null;
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
  registerSection: (id: string, label: string) => void;
  registerSubject: (standardId: string, standardLabel: string, option: TimetableOption) => void;
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
  teacherOptions: TimetableOption[];
  loading: boolean;
}

export function TimetableLookupsProvider({
  academicYearId,
  children,
}: {
  academicYearId: string | null;
  children: React.ReactNode;
}) {
  const { standards } = useStandards(academicYearId);
  const [sectionLabels, setSectionLabels] = React.useState<Map<string, string>>(new Map());
  const [subjectLabels, setSubjectLabels] = React.useState<Map<string, string>>(new Map());
  const [subjectGroupMap, setSubjectGroupMap] = React.useState<Map<string, SubjectGroup>>(
    new Map(),
  );

  const registerSection = React.useCallback((id: string, label: string) => {
    setSectionLabels((prev) => {
      if (prev.get(id) === label) return prev;
      const next = new Map(prev);
      next.set(id, label);
      return next;
    });
  }, []);

  const registerSubject = React.useCallback(
    (standardId: string, standardLabel: string, option: TimetableOption) => {
      setSubjectLabels((prev) => {
        if (prev.get(option.value) === option.label) return prev;
        const next = new Map(prev);
        next.set(option.value, option.label);
        return next;
      });
      setSubjectGroupMap((prev) => {
        const group = prev.get(standardId);
        if (group?.options.some((o) => o.value === option.value)) return prev;
        const next = new Map(prev);
        next.set(standardId, {
          standardId,
          standardLabel,
          options: [...(group?.options ?? []), option],
        });
        return next;
      });
    },
    [],
  );

  const subjectGroups = React.useMemo(
    () => Array.from(subjectGroupMap.values()),
    [subjectGroupMap],
  );

  const value = React.useMemo<LookupsContextValue>(
    () => ({ registerSection, registerSubject, sectionLabels, subjectLabels, subjectGroups }),
    [registerSection, registerSubject, sectionLabels, subjectLabels, subjectGroups],
  );

  return (
    <LookupsContext.Provider value={value}>
      {standards.map((standard) => (
        <StandardLoader key={standard.id} standardId={standard.id} standardName={standard.name} />
      ))}
      {children}
    </LookupsContext.Provider>
  );
}

function StandardLoader({
  standardId,
  standardName,
}: {
  standardId: string;
  standardName: Record<string, string>;
}) {
  const ctx = React.useContext(LookupsContext);
  const resolveI18n = useI18nField();
  const { sections } = useSections(standardId);
  const { subjects } = useSubjectsByStandard(standardId);
  const standardLabel = resolveI18n(standardName);

  React.useEffect(() => {
    if (!ctx) return;
    for (const section of sections) {
      ctx.registerSection(section.id, section.displayLabel ?? resolveI18n(section.name));
    }
  }, [ctx, sections, resolveI18n]);

  React.useEffect(() => {
    if (!ctx) return;
    for (const subject of subjects) {
      ctx.registerSubject(standardId, standardLabel, {
        value: subject.id,
        label: resolveI18n(subject.name),
      });
    }
  }, [ctx, subjects, standardId, standardLabel, resolveI18n]);

  return null;
}

export function useTimetableLookups(): TimetableLookups {
  const ctx = React.useContext(LookupsContext);
  const resolveI18n = useI18nField();
  const { data, loading } = useQuery<{ listStaff: StaffLite[] }>(STAFF_FOR_TIMETABLE);

  return React.useMemo(() => {
    const teacherLabels = new Map<string, string>();
    const teacherOptions: TimetableOption[] = (data?.listStaff ?? []).map((m) => {
      const label = `${resolveI18n(m.firstName)} ${resolveI18n(m.lastName ?? {})}`.trim();
      teacherLabels.set(m.membershipId, label);
      return { value: m.membershipId, label };
    });
    return {
      sectionLabel: (id) => (id ? (ctx?.sectionLabels.get(id) ?? id) : ''),
      subjectLabel: (id) => (id ? (ctx?.subjectLabels.get(id) ?? id) : ''),
      teacherLabel: (id) => (id ? (teacherLabels.get(id) ?? id) : ''),
      subjectGroups: ctx?.subjectGroups ?? [],
      teacherOptions,
      loading,
    };
  }, [ctx, data, resolveI18n, loading]);
}
