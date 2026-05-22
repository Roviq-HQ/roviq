// libs/database/src/seed/demo/data/inst2-standards.ts
import type { StandardDef } from './types';

// ─── TRADITIONAL Standards for Institute 2 (Class 1–10) ─────────────
export const INST2_STANDARDS: StandardDef[] = [
  { name: 'Class 1', order: 1, level: 'PRIMARY', sections: ['A', 'B'], udise: 1 },
  { name: 'Class 2', order: 2, level: 'PRIMARY', sections: ['A', 'B'], udise: 2 },
  { name: 'Class 3', order: 3, level: 'PRIMARY', sections: ['A', 'B'], udise: 3 },
  { name: 'Class 4', order: 4, level: 'PRIMARY', sections: ['A'], udise: 4 },
  { name: 'Class 5', order: 5, level: 'PRIMARY', sections: ['A'], udise: 5 },
  { name: 'Class 6', order: 6, level: 'UPPER_PRIMARY', sections: ['A'], udise: 6 },
  { name: 'Class 7', order: 7, level: 'UPPER_PRIMARY', sections: ['A'], udise: 7 },
  { name: 'Class 8', order: 8, level: 'UPPER_PRIMARY', sections: ['A'], udise: 8 },
  { name: 'Class 9', order: 9, level: 'SECONDARY', sections: ['A'], udise: 9 },
  { name: 'Class 10', order: 10, level: 'SECONDARY', sections: ['A'], udise: 10, boardExam: true },
];
