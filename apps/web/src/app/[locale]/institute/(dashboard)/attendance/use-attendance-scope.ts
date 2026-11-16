'use client';

import * as React from 'react';
import { type AttendanceSectionOption, useAttendanceSections } from './use-attendance';

export interface AttendanceStandardOption {
  id: string;
  name: AttendanceSectionOption['standardName'];
}

export interface AttendanceScopeSelection {
  standardId: string | null;
  sectionId: string | null;
}

export interface ResolvedAttendanceScope extends AttendanceScopeSelection {
  standards: AttendanceStandardOption[];
  sectionsForStandard: AttendanceSectionOption[];
  /** Only offer "all" when it actually aggregates more than one permitted option. */
  allowAllStandards: boolean;
  allowAllSections: boolean;
}

/**
 * Pure selection rules: URL values survive only when the server lists them,
 * and a single permitted option is selected automatically.
 */
export function resolveAttendanceScope(
  sections: readonly AttendanceSectionOption[],
  requested: AttendanceScopeSelection,
  selectsSection = true,
): ResolvedAttendanceScope {
  const standards: AttendanceStandardOption[] = [];
  for (const section of sections) {
    if (!standards.some((standard) => standard.id === section.standardId)) {
      standards.push({ id: section.standardId, name: section.standardName });
    }
  }
  const requestedSection = selectsSection
    ? sections.find((section) => section.id === requested.sectionId)
    : undefined;
  const standardId = standards.some((standard) => standard.id === requested.standardId)
    ? requested.standardId
    : (requestedSection?.standardId ?? (standards.length === 1 ? standards[0].id : null));
  const sectionsForStandard = standardId
    ? sections.filter((section) => section.standardId === standardId)
    : [];
  const sectionId = !selectsSection
    ? null
    : requestedSection && requestedSection.standardId === standardId
      ? requestedSection.id
      : sections.length === 1
        ? sections[0].id
        : null;
  return {
    standards,
    sectionsForStandard,
    standardId,
    sectionId,
    allowAllStandards: standards.length > 1,
    allowAllSections: sectionsForStandard.length > 1,
  };
}

/**
 * Server-authorized standard/section choices for attendance pages. Until the
 * permitted list loads, nothing is selected so no section-scoped request fires.
 */
export function useAttendanceScope(options: {
  academicYearId: string | null;
  requested: AttendanceScopeSelection;
  onResolved: (selection: AttendanceScopeSelection) => void;
  selectsSection: boolean;
}) {
  const { academicYearId, requested, onResolved, selectsSection } = options;
  const { sections, loading } = useAttendanceSections(academicYearId);
  const ready = Boolean(academicYearId) && !loading;
  const resolved = React.useMemo(
    () =>
      ready
        ? resolveAttendanceScope(sections, requested, selectsSection)
        : {
            standards: [],
            sectionsForStandard: [],
            standardId: null,
            sectionId: null,
            allowAllStandards: false,
            allowAllSections: false,
          },
    [ready, sections, requested, selectsSection],
  );

  React.useEffect(() => {
    if (!ready) return;
    if (
      resolved.standardId !== requested.standardId ||
      resolved.sectionId !== requested.sectionId
    ) {
      onResolved({ standardId: resolved.standardId, sectionId: resolved.sectionId });
    }
  }, [ready, resolved.standardId, resolved.sectionId, requested, onResolved]);

  return {
    ...resolved,
    sections,
    ready,
    noAssignments: ready && sections.length === 0,
  };
}
