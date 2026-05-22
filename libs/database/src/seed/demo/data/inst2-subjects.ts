// libs/database/src/seed/demo/data/inst2-subjects.ts
import type { SubjectDef, SubjectMapping } from './types';

// ─── Institute 2 Subjects (BSEH / state board) ──────────────────────
export const INST2_SUBJECTS: SubjectDef[] = [
  {
    name: 'English',
    shortName: 'ENG',
    type: 'LANGUAGE',
    mandatory: true,
    theory: 80,
    internal: 20,
  },
  { name: 'Hindi', shortName: 'HIN', type: 'LANGUAGE', mandatory: true, theory: 80, internal: 20 },
  {
    name: 'Sanskrit',
    shortName: 'SKT',
    type: 'LANGUAGE',
    mandatory: false,
    theory: 80,
    internal: 20,
  },
  {
    name: 'Mathematics',
    shortName: 'MATH',
    type: 'ACADEMIC',
    mandatory: true,
    theory: 80,
    internal: 20,
  },
  {
    name: 'Science',
    shortName: 'SCI',
    type: 'ACADEMIC',
    mandatory: true,
    theory: 80,
    internal: 20,
  },
  {
    name: 'Social Science',
    shortName: 'SST',
    type: 'ACADEMIC',
    mandatory: true,
    theory: 80,
    internal: 20,
  },
  { name: 'Drawing', shortName: 'DRW', type: 'EXTRACURRICULAR', mandatory: false },
  { name: 'Physical Education', shortName: 'PE', type: 'EXTRACURRICULAR', mandatory: false },
  {
    name: 'Computer',
    shortName: 'COMP',
    type: 'SKILL',
    mandatory: false,
    theory: 50,
    practical: 50,
  },
];

export const INST2_SUBJECT_MAPPINGS: SubjectMapping[] = [
  { orderRange: [1, 5], subjects: ['ENG', 'HIN', 'MATH', 'DRW'] },
  { orderRange: [6, 8], subjects: ['ENG', 'HIN', 'SKT', 'MATH', 'SCI', 'SST', 'COMP', 'PE'] },
  { orderRange: [9, 10], subjects: ['ENG', 'HIN', 'SKT', 'MATH', 'SCI', 'SST', 'COMP', 'PE'] },
];
