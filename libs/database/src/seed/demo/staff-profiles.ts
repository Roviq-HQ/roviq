// libs/database/src/seed/demo/staff-profiles.ts

import { SYSTEM_USER_ID, staffProfiles } from '../..';
import type { DrizzleDB } from '../../providers';
import { SEED_IDS } from '../ids';

const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

export async function seedDemoStaffProfiles(tx: DrizzleDB, inst1Id: string): Promise<void> {
  await tx
    .insert(staffProfiles)
    .values({
      id: SEED_IDS.STAFF_PROFILE_1,
      userId: SEED_IDS.USER_TEACHER,
      membershipId: SEED_IDS.MEMBERSHIP_TEACHER_INST1,
      tenantId: inst1Id,
      employeeId: 'SVM/STAFF/001',
      designation: 'PGT Mathematics',
      employmentType: 'REGULAR',
      dateOfJoining: '2022-04-01',
      isClassTeacher: true,
      ...BY,
    })
    .onConflictDoNothing({ target: staffProfiles.id });
  console.log('  Staff profile: teacher1 (PGT Mathematics)');
}
