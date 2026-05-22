// Canonical seed literals shared by seed implementations and e2e fixtures.
// Keep this file free of @roviq/* imports so test projects can resolve it directly.
export const SEED_NAMES = {
  RESELLER_DIRECT: 'Roviq Direct',
  INSTITUTE_1: { en: 'Saraswati Vidya Mandir', hi: 'सरस्वती विद्या मंदिर' },
  INSTITUTE_2: { en: 'Rajasthan Public School', hi: 'राजस्थान पब्लिक स्कूल' },
} as const;

export const SEED_SLUGS = {
  INSTITUTE_1: 'saraswati-vidya-mandir',
  INSTITUTE_2: 'rajasthan-public-school',
} as const;

export const SEED_CREDENTIALS = {
  ADMIN: { username: 'admin', password: 'admin123' },
  RESELLER: { username: 'reseller1', password: 'reseller123' },
  TEACHER: { username: 'teacher1', password: 'teacher123' },
  STUDENT: { username: 'student1', password: 'student123' },
  GUARDIAN: { username: 'guardian1', password: 'guardian123' },
  STUDENT_2: { username: 'student2', password: 'student123' },
  STUDENT_3: { username: 'student3', password: 'student123' },
  STUDENT_4: { username: 'student4', password: 'student123' },
  STUDENT_5: { username: 'student5', password: 'student123' },
  STAFF_2: { username: 'staff2', password: 'staff123' },
  STAFF_3: { username: 'staff3', password: 'staff123' },
  GUARDIAN_2: { username: 'guardian2', password: 'guardian123' },
  GUARDIAN_3: { username: 'guardian3', password: 'guardian123' },
} as const;
