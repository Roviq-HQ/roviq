import type { resellers, sections, standardSubjects, standards, subjects } from '@roviq/database';

export type AdminResellerStatusRow = Pick<
  typeof resellers.$inferSelect,
  'id' | 'status' | 'isActive'
>;

export type AcademicTreeStandardRow = Pick<
  typeof standards.$inferSelect,
  'id' | 'name' | 'numericOrder' | 'department'
>;
export type AcademicTreeSectionRow = Pick<
  typeof sections.$inferSelect,
  'id' | 'name' | 'stream' | 'standardId'
>;
export type AcademicTreeStandardSubjectRow = Pick<
  typeof standardSubjects.$inferSelect,
  'subjectId' | 'standardId'
>;
export type AcademicTreeSubjectRow = Pick<
  typeof subjects.$inferSelect,
  'id' | 'name' | 'shortName' | 'boardCode' | 'type'
>;

/** The rows of an institute's most recent academic year, read in one transaction. */
export type AcademicTreeRows =
  | { academicYearId: null }
  | {
      academicYearId: string;
      standards: AcademicTreeStandardRow[];
      sections: AcademicTreeSectionRow[];
      standardSubjects: AcademicTreeStandardSubjectRow[];
      subjects: AcademicTreeSubjectRow[];
    };
