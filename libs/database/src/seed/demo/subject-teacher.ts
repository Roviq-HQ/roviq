// libs/database/src/seed/demo/subject-teacher.ts
//
// subjectteacher1: a subject_teacher (not a class teacher) in Institute 1. The
// demo timetable seeder gives her the Hindi periods, which puts the section in
// her `assignedSections`.
import { hash } from '@node-rs/argon2';
import { type DefaultRole, DefaultRoles } from '@roviq/common-types';
import { sql } from 'drizzle-orm';
import {
  authProviders,
  memberships,
  SYSTEM_USER_ID,
  staffProfiles,
  userProfiles,
  users,
} from '../..';
import type { DrizzleDB } from '../../providers';
import { SEED_CREDENTIALS, SEED_PERSON_NAMES } from '../fixtures';
import { SEED_IDS } from '../ids';

const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

export async function seedDemoSubjectTeacher(
  tx: DrizzleDB,
  inst1Id: string,
  roleIds: Partial<Record<DefaultRole, string>>,
): Promise<void> {
  const roleId = roleIds[DefaultRoles.SubjectTeacher];
  if (!roleId) throw new Error(`Role "${DefaultRoles.SubjectTeacher}" not found in seeded roles`);

  const [user] = await tx
    .insert(users)
    .values({
      id: SEED_IDS.USER_SUBJECT_TEACHER,
      username: SEED_CREDENTIALS.SUBJECT_TEACHER.username,
      email: 'subjectteacher1@svm-ggn.edu.in',
      passwordHash: await hash(SEED_CREDENTIALS.SUBJECT_TEACHER.password),
      ...BY,
    })
    .onConflictDoUpdate({ target: users.username, set: { updatedAt: new Date() } })
    .returning();

  await tx
    .insert(userProfiles)
    .values({
      userId: user.id,
      firstName: SEED_PERSON_NAMES.SUBJECT_TEACHER.firstName,
      lastName: SEED_PERSON_NAMES.SUBJECT_TEACHER.lastName,
      gender: 'FEMALE',
      ...BY,
    })
    .onConflictDoNothing();

  await tx
    .insert(memberships)
    .values({
      id: SEED_IDS.MEMBERSHIP_SUBJECT_TEACHER_INST1,
      userId: user.id,
      tenantId: inst1Id,
      roleId,
      ...BY,
    })
    .onConflictDoUpdate({
      target: [memberships.userId, memberships.tenantId, memberships.roleId],
      set: { updatedAt: new Date() },
    });

  await tx
    .insert(authProviders)
    .values({
      userId: user.id,
      provider: 'password',
      providerUserId: user.id,
      ...BY,
    })
    .onConflictDoUpdate({
      target: [authProviders.provider, authProviders.providerUserId],
      targetWhere: sql`deleted_at IS NULL`,
      set: { updatedAt: new Date() },
    });

  await tx
    .insert(staffProfiles)
    .values({
      id: SEED_IDS.STAFF_PROFILE_SUBJECT_TEACHER,
      userId: user.id,
      membershipId: SEED_IDS.MEMBERSHIP_SUBJECT_TEACHER_INST1,
      tenantId: inst1Id,
      employeeId: 'SVM/STAFF/004',
      designation: 'PRT Hindi',
      employmentType: 'REGULAR',
      dateOfJoining: '2023-06-15',
      isClassTeacher: false,
      ...BY,
    })
    .onConflictDoNothing({ target: staffProfiles.id });
}
