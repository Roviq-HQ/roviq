import { eq } from 'drizzle-orm';
import type { DrizzleDB } from '../../providers';
import { institutes } from '../../schema';
import { mkAdminCtx, withAdmin } from '../../tenant-db';
import { seedEssential } from '../essential';
import { SEED_SLUGS } from '../fixtures';
import { SEED_IDS } from '../ids';
import { linkSubjectsToStructure, seedAcademicStructure, seedSubjects } from './academics';
import { seedAttendanceAndLeaves } from './attendance';
import {
  INST1_STANDARDS,
  INST1_SUBJECT_MAPPINGS,
  INST1_SUBJECTS,
  INST2_STANDARDS,
  INST2_SUBJECT_MAPPINGS,
  INST2_SUBJECTS,
} from './data';
import {
  seedBrandingAndConfigs,
  seedIdentifiersAndAffiliations,
  seedInstitutes,
  seedNotificationConfigs,
} from './institutes';
import { seedDemoStaffProfiles } from './staff-profiles';
import { seedInstituteRoles, seedUsersAndMemberships } from './users';

export async function seedDemo(db: DrizzleDB): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Safety violation: Demo seed cannot run in production');
  }

  await seedEssential(db);

  await withAdmin(db, mkAdminCtx('seeder:demo'), async (tx) => {
    const exists = await tx
      .select({ id: institutes.id })
      .from(institutes)
      .where(eq(institutes.slug, SEED_SLUGS.INSTITUTE_1))
      .limit(1);
    if (exists.length > 0) {
      await seedDemoStaffProfiles(tx, exists[0].id);
      await seedAttendanceAndLeaves(tx, exists[0].id);
      return;
    }

    const { inst1, inst2 } = await seedInstitutes(tx);
    await seedBrandingAndConfigs(tx, inst1.id, inst2.id);
    await seedIdentifiersAndAffiliations(tx, inst1.id, inst2.id);
    await seedNotificationConfigs(tx, [inst1.id, inst2.id]);

    const ay1 = await seedAcademicStructure(
      tx,
      inst1.id,
      SEED_IDS.ACADEMIC_YEAR_INST1,
      INST1_STANDARDS,
      'Institute 1 (NEP)',
    );
    const ay2 = await seedAcademicStructure(
      tx,
      inst2.id,
      SEED_IDS.ACADEMIC_YEAR_INST2,
      INST2_STANDARDS,
      'Institute 2 (Traditional)',
    );

    const inst1SubjectIds = await seedSubjects(tx, inst1.id, INST1_SUBJECTS);
    const inst2SubjectIds = await seedSubjects(tx, inst2.id, INST2_SUBJECTS);

    if (ay1)
      await linkSubjectsToStructure(tx, inst1.id, ay1.id, inst1SubjectIds, INST1_SUBJECT_MAPPINGS);
    if (ay2)
      await linkSubjectsToStructure(tx, inst2.id, ay2.id, inst2SubjectIds, INST2_SUBJECT_MAPPINGS);

    const { roleIds, roleIds2 } = await seedInstituteRoles(tx, inst1.id, inst2.id);
    await seedUsersAndMemberships(tx, inst1.id, inst2.id, roleIds, roleIds2);
    await seedDemoStaffProfiles(tx, inst1.id);

    await seedAttendanceAndLeaves(tx, inst1.id);
  });
}
