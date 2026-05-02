// libs/database/src/seed/e2e/guardians.ts
import { hash } from '@node-rs/argon2';
import { DefaultRoles } from '@roviq/common-types';
import { and, isNull, sql } from 'drizzle-orm';
import {
  authProviders,
  guardianProfiles,
  memberships,
  roles,
  SYSTEM_USER_ID,
  studentGuardianLinks,
  userProfiles,
  users,
} from '../..';
import type { DrizzleDB } from '../../providers';
import { SEED_IDS } from '../ids';

const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
const GUARDIAN_PASSWORD_PLAIN = 'guardian123';

export async function seedE2eGuardians(tx: DrizzleDB, instituteId: string): Promise<void> {
  const parentRoleRows = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(
      and(
        sql`${roles.tenantId} = ${instituteId}::uuid`,
        sql`${roles.name}->>'en' = ${DefaultRoles.Parent}`,
        isNull(roles.deletedAt),
      ),
    )
    .limit(1);
  const parentRoleId = parentRoleRows[0]?.id;
  if (!parentRoleId) {
    throw new Error(`parent role not found for institute ${instituteId} — run demo seed first`);
  }

  const guardianPassword = await hash(GUARDIAN_PASSWORD_PLAIN);

  const newGuardians = [
    {
      userId: SEED_IDS.USER_GUARDIAN_2,
      membershipId: SEED_IDS.MEMBERSHIP_GUARDIAN_2,
      profileId: SEED_IDS.GUARDIAN_PROFILE_2,
      username: 'guardian2',
      email: 'guardian2@example.com',
      firstName: { en: 'Sunita', hi: 'सुनीता' },
      lastName: { en: 'Patel', hi: 'पटेल' },
      occupation: 'Teacher',
    },
    {
      userId: SEED_IDS.USER_GUARDIAN_3,
      membershipId: SEED_IDS.MEMBERSHIP_GUARDIAN_3,
      profileId: SEED_IDS.GUARDIAN_PROFILE_3,
      username: 'guardian3',
      email: 'guardian3@example.com',
      firstName: { en: 'Anil', hi: 'अनिल' },
      lastName: { en: 'Verma', hi: 'वर्मा' },
      occupation: 'Business',
    },
  ];

  await tx
    .insert(users)
    .values(
      newGuardians.map((g) => ({
        id: g.userId,
        username: g.username,
        email: g.email,
        passwordHash: guardianPassword,
      })),
    )
    .onConflictDoNothing({ target: users.id });

  await tx
    .insert(userProfiles)
    .values(
      newGuardians.map((g) => ({
        userId: g.userId,
        firstName: g.firstName,
        lastName: g.lastName,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })),
    )
    .onConflictDoNothing();

  await tx
    .insert(memberships)
    .values(
      newGuardians.map((g) => ({
        id: g.membershipId,
        userId: g.userId,
        tenantId: instituteId,
        roleId: parentRoleId,
        ...BY,
      })),
    )
    .onConflictDoNothing({ target: memberships.id });

  await tx
    .insert(authProviders)
    .values(
      newGuardians.map((g) => ({
        userId: g.userId,
        provider: 'password',
        providerUserId: g.userId,
      })),
    )
    .onConflictDoNothing();

  await tx
    .insert(guardianProfiles)
    .values(
      newGuardians.map((g) => ({
        id: g.profileId,
        userId: g.userId,
        membershipId: g.membershipId,
        tenantId: instituteId,
        occupation: g.occupation,
        ...BY,
      })),
    )
    .onConflictDoNothing({ target: guardianProfiles.id });

  // 4 new links — guardian1→student2 (sibling cross-family), guardian2 to 2&3, guardian3 to 4.
  await tx
    .insert(studentGuardianLinks)
    .values([
      {
        id: SEED_IDS.LINK_G1_S2,
        tenantId: instituteId,
        studentProfileId: SEED_IDS.STUDENT_PROFILE_2,
        guardianProfileId: SEED_IDS.GUARDIAN_PROFILE_1,
        relationship: 'FATHER',
        isPrimaryContact: true,
        isEmergencyContact: true,
        canPickup: true,
        livesWith: true,
      },
      {
        id: SEED_IDS.LINK_G2_S2,
        tenantId: instituteId,
        studentProfileId: SEED_IDS.STUDENT_PROFILE_2,
        guardianProfileId: SEED_IDS.GUARDIAN_PROFILE_2,
        relationship: 'MOTHER',
        isPrimaryContact: false,
        isEmergencyContact: true,
        canPickup: true,
        livesWith: true,
      },
      {
        id: SEED_IDS.LINK_G2_S3,
        tenantId: instituteId,
        studentProfileId: SEED_IDS.STUDENT_PROFILE_3,
        guardianProfileId: SEED_IDS.GUARDIAN_PROFILE_2,
        relationship: 'MOTHER',
        isPrimaryContact: true,
        isEmergencyContact: true,
        canPickup: true,
        livesWith: true,
      },
      {
        id: SEED_IDS.LINK_G3_S4,
        tenantId: instituteId,
        studentProfileId: SEED_IDS.STUDENT_PROFILE_4,
        guardianProfileId: SEED_IDS.GUARDIAN_PROFILE_3,
        relationship: 'FATHER',
        isPrimaryContact: true,
        isEmergencyContact: true,
        canPickup: true,
        livesWith: true,
      },
    ])
    .onConflictDoNothing();

  console.log('  E2E guardians: guardian2, guardian3 + 4 student-guardian links');
}
