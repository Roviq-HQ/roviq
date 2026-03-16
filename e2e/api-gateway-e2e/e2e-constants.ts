export { SEED_IDS } from '../../scripts/seed-ids';

// Credentials for seeded test users
export const E2E_USERS = {
  ADMIN: { username: 'admin', password: 'admin123' },
  TEACHER: { username: 'teacher1', password: 'teacher123' },
  STUDENT: { username: 'student1', password: 'student123' },
} as const;
