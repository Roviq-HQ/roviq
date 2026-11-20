// libs/database/src/seed/demo/multi-child-guardian.ts
//
// guardian4 with two enrolled children (student6, student7) in student1's
// section, so guardian flows that preselect an only child can be tested with
// more than one. guardian1's links stay untouched.
import { hash } from '@node-rs/argon2';
import { type DefaultRole, DefaultRoles } from '@roviq/common-types';
import { eq, sql } from 'drizzle-orm';
import {
  authProviders,
  guardianProfiles,
  memberships,
  SYSTEM_USER_ID,
  studentAcademics,
  studentGuardianLinks,
  studentProfiles,
  userProfiles,
  users,
} from '../..';
import type { DrizzleDB } from '../../providers';
import { SEED_CREDENTIALS, SEED_PERSON_NAMES } from '../fixtures';
import { SEED_IDS } from '../ids';

const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

const CHILDREN = [
  {
    userId: SEED_IDS.USER_STUDENT_6,
    membershipId: SEED_IDS.MEMBERSHIP_STUDENT_6,
    profileId: SEED_IDS.STUDENT_PROFILE_6,
    academicId: SEED_IDS.STUDENT_ACADEMIC_6,
    linkId: SEED_IDS.LINK_G4_S6,
    credentials: SEED_CREDENTIALS.STUDENT_6,
    names: SEED_PERSON_NAMES.STUDENT_6,
    gender: 'MALE',
    admissionNumber: 'S-2026/0006',
    rollNumber: '02',
  },
  {
    userId: SEED_IDS.USER_STUDENT_7,
    membershipId: SEED_IDS.MEMBERSHIP_STUDENT_7,
    profileId: SEED_IDS.STUDENT_PROFILE_7,
    academicId: SEED_IDS.STUDENT_ACADEMIC_7,
    linkId: SEED_IDS.LINK_G4_S7,
    credentials: SEED_CREDENTIALS.STUDENT_7,
    names: SEED_PERSON_NAMES.STUDENT_7,
    gender: 'FEMALE',
    admissionNumber: 'S-2026/0007',
    rollNumber: '03',
  },
] as const;

function requireRole(roleIds: Partial<Record<DefaultRole, string>>, role: DefaultRole): string {
  const id = roleIds[role];
  if (!id) throw new Error(`Role "${role}" not found in seeded roles`);
  return id;
}

/** Runs after `seedAttendanceAndLeaves`, which enrols student1 into the section reused here. */
export async function seedDemoMultiChildGuardian(
  tx: DrizzleDB,
  inst1Id: string,
  roleIds: Partial<Record<DefaultRole, string>>,
): Promise<void> {
  const studentRoleId = requireRole(roleIds, DefaultRoles.Student);
  const parentRoleId = requireRole(roleIds, DefaultRoles.Parent);

  const [student1Academic] = await tx
    .select({
      academicYearId: studentAcademics.academicYearId,
      standardId: studentAcademics.standardId,
      sectionId: studentAcademics.sectionId,
    })
    .from(studentAcademics)
    .where(eq(studentAcademics.id, SEED_IDS.STUDENT_ACADEMIC_1))
    .limit(1);
  if (!student1Academic) {
    throw new Error(
      'student1 is not enrolled in a section — seedAttendanceAndLeaves must run first',
    );
  }

  const studentPassword = await hash(SEED_CREDENTIALS.STUDENT_6.password);
  const guardianPassword = await hash(SEED_CREDENTIALS.GUARDIAN_4.password);

  const people = [
    ...CHILDREN.map((c) => ({
      userId: c.userId,
      username: c.credentials.username,
      email: `${c.credentials.username}@svm-ggn.edu.in`,
      passwordHash: studentPassword,
      names: c.names,
      gender: c.gender,
    })),
    {
      userId: SEED_IDS.USER_GUARDIAN_4,
      username: SEED_CREDENTIALS.GUARDIAN_4.username,
      email: 'guardian4@example.com',
      passwordHash: guardianPassword,
      names: SEED_PERSON_NAMES.GUARDIAN_4,
      gender: 'FEMALE',
    },
  ] as const;

  for (const p of people) {
    await tx
      .insert(users)
      .values({
        id: p.userId,
        username: p.username,
        email: p.email,
        passwordHash: p.passwordHash,
        ...BY,
      })
      .onConflictDoUpdate({ target: users.username, set: { updatedAt: new Date() } });

    await tx
      .insert(userProfiles)
      .values({
        userId: p.userId,
        firstName: p.names.firstName,
        lastName: p.names.lastName,
        gender: p.gender,
        ...BY,
      })
      .onConflictDoNothing();

    await tx
      .insert(authProviders)
      .values({ userId: p.userId, provider: 'password', providerUserId: p.userId, ...BY })
      .onConflictDoUpdate({
        target: [authProviders.provider, authProviders.providerUserId],
        targetWhere: sql`deleted_at IS NULL`,
        set: { updatedAt: new Date() },
      });
  }

  for (const [userId, membershipId, roleId] of [
    ...CHILDREN.map((c) => [c.userId, c.membershipId, studentRoleId] as const),
    [SEED_IDS.USER_GUARDIAN_4, SEED_IDS.MEMBERSHIP_GUARDIAN_4, parentRoleId] as const,
  ]) {
    await tx
      .insert(memberships)
      .values({ id: membershipId, userId, tenantId: inst1Id, roleId, ...BY })
      .onConflictDoUpdate({
        target: [memberships.userId, memberships.tenantId, memberships.roleId],
        set: { updatedAt: new Date() },
      });
  }

  for (const c of CHILDREN) {
    await tx
      .insert(studentProfiles)
      .values({
        id: c.profileId,
        userId: c.userId,
        membershipId: c.membershipId,
        tenantId: inst1Id,
        admissionNumber: c.admissionNumber,
        admissionDate: '2026-04-01',
        admissionType: 'NEW',
        academicStatus: 'ENROLLED',
        socialCategory: 'GENERAL',
        isRteAdmitted: false,
        ...BY,
      })
      .onConflictDoNothing({ target: studentProfiles.id });

    await tx
      .insert(studentAcademics)
      .values({
        id: c.academicId,
        tenantId: inst1Id,
        studentProfileId: c.profileId,
        academicYearId: student1Academic.academicYearId,
        standardId: student1Academic.standardId,
        sectionId: student1Academic.sectionId,
        rollNumber: c.rollNumber,
        ...BY,
      })
      .onConflictDoNothing({ target: studentAcademics.id });
  }

  await tx
    .insert(guardianProfiles)
    .values({
      id: SEED_IDS.GUARDIAN_PROFILE_4,
      userId: SEED_IDS.USER_GUARDIAN_4,
      membershipId: SEED_IDS.MEMBERSHIP_GUARDIAN_4,
      tenantId: inst1Id,
      occupation: 'Doctor',
      ...BY,
    })
    .onConflictDoNothing({ target: guardianProfiles.id });

  await tx
    .insert(studentGuardianLinks)
    .values(
      CHILDREN.map((c) => ({
        id: c.linkId,
        tenantId: inst1Id,
        studentProfileId: c.profileId,
        guardianProfileId: SEED_IDS.GUARDIAN_PROFILE_4,
        relationship: 'MOTHER' as const,
        isPrimaryContact: true,
        isEmergencyContact: true,
        canPickup: true,
        livesWith: true,
        ...BY,
      })),
    )
    .onConflictDoNothing();
}
