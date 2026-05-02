// libs/database/src/seed/demo/data/types.ts

export type EducationLevel =
  | 'PRE_PRIMARY'
  | 'PRIMARY'
  | 'UPPER_PRIMARY'
  | 'SECONDARY'
  | 'SENIOR_SECONDARY';

export type NepStage = 'FOUNDATIONAL' | 'PREPARATORY' | 'MIDDLE' | 'SECONDARY';

export type SubjectType =
  | 'ACADEMIC'
  | 'LANGUAGE'
  | 'SKILL'
  | 'EXTRACURRICULAR'
  | 'INTERNAL_ASSESSMENT';

export interface StandardDef {
  name: string;
  order: number;
  level: EducationLevel;
  nep?: NepStage;
  sections: string[];
  udise: number;
  boardExam?: boolean;
  stream?: boolean;
}

export interface SubjectDef {
  name: string;
  shortName: string;
  boardCode?: string;
  type: SubjectType;
  mandatory: boolean;
  theory?: number;
  practical?: number;
  internal?: number;
}

export interface SubjectMapping {
  orderRange: [number, number];
  subjects: string[];
}
