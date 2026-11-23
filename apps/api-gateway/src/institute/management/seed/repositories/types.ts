import type { StandardTemplate } from '../board-templates';

export interface StandardSeed {
  template: StandardTemplate;
  /** Already resolved against the board's exam classes. */
  isBoardExamClass: boolean;
}

export interface SectionStrengthNorms {
  optimal: number;
  hardMax: number;
  exemptionAllowed: boolean;
}

export interface FirstAcademicYearData {
  label: string;
  startDate: string;
  endDate: string;
}

export type SetupStatus = 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
