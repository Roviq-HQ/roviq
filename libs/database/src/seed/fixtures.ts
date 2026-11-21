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
