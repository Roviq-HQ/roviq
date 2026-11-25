// Canonical seed literals shared by seed implementations and e2e fixtures.
// Keep this file free of @roviq/* imports so test projects can resolve it directly.
import type { AdmissionNumberConfig } from '../schema/tenant/institute-configs';
import {
  admissionSeriesName,
  formatSequenceValue,
  resolveAdmissionPrefix,
  resolveAdmissionYear,
} from '../sequences/admission-number';

export const SEED_NAMES = {
  RESELLER_DIRECT: 'Roviq Direct',
  INSTITUTE_1: { en: 'Saraswati Vidya Mandir', hi: 'सरस्वती विद्या मंदिर' },
  INSTITUTE_2: { en: 'Rajasthan Public School', hi: 'राजस्थान पब्लिक स्कूल' },
} as const;

export const SEED_SLUGS = {
  INSTITUTE_1: 'saraswati-vidya-mandir',
  INSTITUTE_2: 'rajasthan-public-school',
} as const;

/** Primary phone of the seeded institute admin: where impersonation approval codes go. */
export const SEED_ADMIN_PHONE = { countryCode: '+91', number: '9876500001' } as const;

export const SEED_CREDENTIALS = {
  ADMIN: { username: 'admin', password: 'admin123' },
  RESELLER: { username: 'reseller1', password: 'reseller123' },
  TEACHER: { username: 'teacher1', password: 'teacher123' },
  STUDENT: { username: 'student1', password: 'student123' },
  GUARDIAN: { username: 'guardian1', password: 'Guardian123' },
  STUDENT_2: { username: 'student2', password: 'student123' },
  STUDENT_3: { username: 'student3', password: 'student123' },
  STUDENT_4: { username: 'student4', password: 'student123' },
  STUDENT_5: { username: 'student5', password: 'student123' },
  STAFF_2: { username: 'staff2', password: 'staff123' },
  STAFF_3: { username: 'staff3', password: 'staff123' },
  GUARDIAN_2: { username: 'guardian2', password: 'guardian123' },
  GUARDIAN_3: { username: 'guardian3', password: 'guardian123' },
  SUBJECT_TEACHER: { username: 'subjectteacher1', password: 'teacher123' },
  GUARDIAN_4: { username: 'guardian4', password: 'guardian123' },
  STUDENT_6: { username: 'student6', password: 'student123' },
  STUDENT_7: { username: 'student7', password: 'student123' },
} as const;

export const SEED_PERSON_NAMES = {
  SUBJECT_TEACHER: {
    firstName: { en: 'Anjali', hi: 'अंजलि' },
    lastName: { en: 'Mehta', hi: 'मेहता' },
  },
  GUARDIAN_4: {
    firstName: { en: 'Kiran', hi: 'किरण' },
    lastName: { en: 'Kapoor', hi: 'कपूर' },
  },
  STUDENT_6: {
    firstName: { en: 'Ishaan', hi: 'ईशान' },
    lastName: { en: 'Kapoor', hi: 'कपूर' },
  },
  STUDENT_7: {
    firstName: { en: 'Meher', hi: 'मेहर' },
    lastName: { en: 'Kapoor', hi: 'कपूर' },
  },
} as const;

export const SEED_ADMISSION_NUMBER_CONFIG = {
  INST1: {
    format: '{prefix}{year}/{value:04d}',
    year_format: 'YYYY',
    prefixes: { '-3': 'N-', '-2': 'L-', '-1': 'U-', '1': 'A-' },
    no_prefix_from_class: 2,
  },
  INST2: {
    format: 'RPS/{year}/{value:04d}',
    year_format: 'YY-YY',
    prefixes: {},
    no_prefix_from_class: 1,
  },
} as const satisfies Record<string, AdmissionNumberConfig>;

/** A seeded admission, numbered the way the runtime would have numbered it on that date. */
export interface SeedAdmission {
  numericOrder: number;
  value: number;
  /** `YYYY-MM-DD`, stored as `student_profiles.admission_date`. */
  admissionDate: string;
  prefix: string;
  series: string;
  admissionNumber: string;
}

function seedAdmission(
  config: AdmissionNumberConfig,
  numericOrder: number,
  value: number,
  admissionDate: string,
): SeedAdmission {
  const [y, m, d] = admissionDate.split('-').map(Number);
  // Built from parts: `new Date('YYYY-MM-DD')` is UTC midnight and can fall in March locally.
  const year = resolveAdmissionYear(config, new Date(y, m - 1, d));
  const prefix = resolveAdmissionPrefix(config, numericOrder);
  return {
    numericOrder,
    value,
    admissionDate,
    prefix,
    series: admissionSeriesName(prefix),
    admissionNumber: formatSequenceValue(config.format, { prefix, year, value: BigInt(value) }),
  };
}

const NURSERY = -3;
const CLASS_5 = 5;

/** Institute 1's seeded students: three in Nursery (demo seed), four in Class 5 (e2e seed). */
export const SEED_ADMISSIONS = {
  STUDENT_1: seedAdmission(SEED_ADMISSION_NUMBER_CONFIG.INST1, NURSERY, 1, '2026-04-01'),
  STUDENT_6: seedAdmission(SEED_ADMISSION_NUMBER_CONFIG.INST1, NURSERY, 2, '2026-04-01'),
  STUDENT_7: seedAdmission(SEED_ADMISSION_NUMBER_CONFIG.INST1, NURSERY, 3, '2026-04-01'),
  STUDENT_2: seedAdmission(SEED_ADMISSION_NUMBER_CONFIG.INST1, CLASS_5, 1, '2025-04-01'),
  STUDENT_3: seedAdmission(SEED_ADMISSION_NUMBER_CONFIG.INST1, CLASS_5, 2, '2025-04-01'),
  STUDENT_4: seedAdmission(SEED_ADMISSION_NUMBER_CONFIG.INST1, CLASS_5, 3, '2025-04-01'),
  STUDENT_5: seedAdmission(SEED_ADMISSION_NUMBER_CONFIG.INST1, CLASS_5, 4, '2025-04-01'),
} as const;
