// libs/database/src/seed/e2e/students.ts
import { hash } from '@node-rs/argon2';
import { DefaultRoles } from '@roviq/common-types';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  authProviders,
  memberships,
  roles,
  SYSTEM_USER_ID,
  sections,
  studentAcademics,
  studentProfiles,
  userProfiles,
  users,
} from '../..';
import type { DrizzleDB } from '../../providers';
import { SEED_IDS } from '../ids';

const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
const STUDENT_PASSWORD_PLAIN = 'student123';

interface StudentFixture {
  userId: string;
  membershipId: string;
  profileId: string;
  academicId: string;
  username: string;
  email: string;
  firstName: { en: string; hi: string };
  lastName: { en: string; hi: string };
  admissionNumber: string;
  academicStatus: 'ENROLLED' | 'GRADUATED' | 'TRANSFERRED_OUT';
  socialCategory: 'GENERAL' | 'OBC' | 'SC' | 'ST';
  isRteAdmitted: boolean;
}

export async function seedE2eStudents(
  tx: DrizzleDB,
  instituteId: string,
  academicYearId: string,
): Promise<void> {
  const studentRoleRows = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(
      and(
        sql`${roles.tenantId} = ${instituteId}::uuid`,
        sql`${roles.name}->>'en' = ${DefaultRoles.Student}`,
        isNull(roles.deletedAt),
      ),
    )
    .limit(1);
  const studentRoleId = studentRoleRows[0]?.id;
  if (!studentRoleId) {
    throw new Error(`student role not found for institute ${instituteId} — run demo seed first`);
  }

  // Class 5-A is a stable Institute-1 section across both NEP and Traditional configs.
  const sectionRows = await tx
    .select({ id: sections.id, standardId: sections.standardId })
    .from(sections)
    .where(
      and(
        eq(sections.tenantId, instituteId),
        eq(sections.academicYearId, academicYearId),
        sql`${sections.displayLabel} = 'Class 5-A'`,
        isNull(sections.deletedAt),
      ),
    )
    .limit(1);
  const section = sectionRows[0];
  if (!section) {
    throw new Error('Section "Class 5-A" not found — run demo seed first');
  }

  const studentPassword = await hash(STUDENT_PASSWORD_PLAIN);

  const fixtures: StudentFixture[] = [
    {
      userId: SEED_IDS.USER_STUDENT_2,
      membershipId: SEED_IDS.MEMBERSHIP_STUDENT_2,
      profileId: SEED_IDS.STUDENT_PROFILE_2,
      academicId: SEED_IDS.STUDENT_ACADEMIC_2,
      username: 'student2',
      email: 'student2@svm-ggn.edu.in',
      firstName: { en: 'Priya', hi: 'प्रिया' },
      lastName: { en: 'Patel', hi: 'पटेल' },
      admissionNumber: '2025/0002',
      academicStatus: 'ENROLLED',
      socialCategory: 'OBC',
      isRteAdmitted: false,
    },
    {
      userId: SEED_IDS.USER_STUDENT_3,
      membershipId: SEED_IDS.MEMBERSHIP_STUDENT_3,
      profileId: SEED_IDS.STUDENT_PROFILE_3,
      academicId: SEED_IDS.STUDENT_ACADEMIC_3,
      username: 'student3',
      email: 'student3@svm-ggn.edu.in',
      firstName: { en: 'Rahul', hi: 'राहुल' },
      lastName: { en: 'Verma', hi: 'वर्मा' },
      admissionNumber: '2025/0003',
      academicStatus: 'ENROLLED',
      socialCategory: 'SC',
      isRteAdmitted: true,
    },
    {
      userId: SEED_IDS.USER_STUDENT_4,
      membershipId: SEED_IDS.MEMBERSHIP_STUDENT_4,
      profileId: SEED_IDS.STUDENT_PROFILE_4,
      academicId: SEED_IDS.STUDENT_ACADEMIC_4,
      username: 'student4',
      email: 'student4@svm-ggn.edu.in',
      firstName: { en: 'Kavya', hi: 'काव्या' },
      lastName: { en: 'Singh', hi: 'सिंह' },
      admissionNumber: '2025/0004',
      academicStatus: 'GRADUATED',
      socialCategory: 'GENERAL',
      isRteAdmitted: false,
    },
    {
      userId: SEED_IDS.USER_STUDENT_5,
      membershipId: SEED_IDS.MEMBERSHIP_STUDENT_5,
      profileId: SEED_IDS.STUDENT_PROFILE_5,
      academicId: SEED_IDS.STUDENT_ACADEMIC_5,
      username: 'student5',
      email: 'student5@svm-ggn.edu.in',
      firstName: { en: 'Amit', hi: 'अमित' },
      lastName: { en: 'Kumar', hi: 'कुमार' },
      admissionNumber: '2025/0005',
      academicStatus: 'TRANSFERRED_OUT',
      socialCategory: 'ST',
      isRteAdmitted: false,
    },
  ];

  await tx
    .insert(users)
    .values(
      fixtures.map((s) => ({
        id: s.userId,
        username: s.username,
        email: s.email,
        passwordHash: studentPassword,
      })),
    )
    .onConflictDoNothing({ target: users.id });

  await tx
    .insert(userProfiles)
    .values(
      fixtures.map((s) => ({
        userId: s.userId,
        firstName: s.firstName,
        lastName: s.lastName,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })),
    )
    .onConflictDoNothing();

  await tx
    .insert(memberships)
    .values(
      fixtures.map((s) => ({
        id: s.membershipId,
        userId: s.userId,
        tenantId: instituteId,
        roleId: studentRoleId,
        ...BY,
      })),
    )
    .onConflictDoNothing({ target: memberships.id });

  await tx
    .insert(authProviders)
    .values(
      fixtures.map((s) => ({
        userId: s.userId,
        provider: 'password',
        providerUserId: s.userId,
      })),
    )
    .onConflictDoNothing();

  await tx
    .insert(studentProfiles)
    .values(
      fixtures.map((s) => ({
        id: s.profileId,
        userId: s.userId,
        membershipId: s.membershipId,
        tenantId: instituteId,
        admissionNumber: s.admissionNumber,
        admissionDate: '2025-04-01',
        admissionType: 'NEW' as const,
        academicStatus: s.academicStatus,
        socialCategory: s.socialCategory,
        isRteAdmitted: s.isRteAdmitted,
        ...BY,
      })),
    )
    .onConflictDoNothing({ target: studentProfiles.id });

  await tx
    .insert(studentAcademics)
    .values(
      fixtures.map((s) => ({
        id: s.academicId,
        studentProfileId: s.profileId,
        academicYearId,
        standardId: section.standardId,
        sectionId: section.id,
        tenantId: instituteId,
        ...BY,
      })),
    )
    .onConflictDoNothing({ target: studentAcademics.id });

  console.log('  E2E students: student2–5 (3 ENROLLED, 1 GRADUATED, 1 TRANSFERRED_OUT)');
}
