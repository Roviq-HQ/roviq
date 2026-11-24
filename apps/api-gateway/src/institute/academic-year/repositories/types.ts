import type { AcademicYearStatus, I18nContent } from '@roviq/database';
import type { YearRolloverCounts, YearRolloverMove } from '../../student/year-rollover';

export interface AcademicYearRecord {
  id: string;
  tenantId: string;
  label: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  status: AcademicYearStatus;
  termStructure: unknown[];
  boardExamDates: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAcademicYearData {
  label: string;
  startDate: string;
  endDate: string;
  termStructure?: unknown[];
}

export interface UpdateAcademicYearData {
  label?: string;
  startDate?: string;
  endDate?: string;
  termStructure?: unknown[];
  boardExamDates?: Record<string, unknown>;
}

/** A section of the year being activated, with what the rollover would add to it. */
export interface RolloverSectionLoadRecord {
  sectionId: string;
  standardId: string;
  standardName: I18nContent;
  sectionName: I18nContent;
  currentStrength: number;
  incoming: number;
}

export interface RolloverSectionMoveRecord extends YearRolloverMove {
  fromStandardName: I18nContent;
  fromSectionName: I18nContent;
}

export interface RolloverPreviewRecord {
  counts: YearRolloverCounts;
  sections: RolloverSectionLoadRecord[];
  moves: RolloverSectionMoveRecord[];
  /** The institute's hard limit per section; null when its configuration has none. */
  hardMax: number | null;
}

export interface RolloverSectionMapEntry {
  fromSectionId: string;
  /** Null removes the override: the section follows the name rule again. */
  toSectionId: string | null;
}

export type SetRolloverSectionMapResult =
  | { kind: 'ok' }
  | { kind: 'year_not_found' }
  | { kind: 'year_is_active' }
  | { kind: 'no_active_year' }
  | { kind: 'section_not_found'; sectionId: string };
