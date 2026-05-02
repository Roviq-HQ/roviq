// libs/database/src/seed/e2e/staff.ts
import { hash } from '@node-rs/argon2';
import { DefaultRoles } from '@roviq/common-types';
import { and, inArray, isNull, sql } from 'drizzle-orm';
import {
  authProviders,
  memberships,
  roles,
  SYSTEM_USER_ID,
  staffProfiles,
  userProfiles,
  users,
} from '../..';
import type { DrizzleDB } from '../../providers';
import { SEED_IDS } from '../ids';

const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
const STAFF_PASSWORD_PLAIN = 'staff123';

interface StaffFixture {
  userId: string;
  membershipId: string;
  profileId: string;
  username: string;
  email: string;
  firstName: { en: string; hi: string };
  lastName: { en: string; hi: string };
  employeeId: string;
  designation: string;
  employmentType: 'REGULAR' | 'CONTRACTUAL';
  roleName: string;
}

export async function seedE2eStaff(tx: DrizzleDB, instituteId: string): Promise<void> {
  const fixtures: StaffFixture[] = [
    {
      userId: SEED_IDS.USER_STAFF_2,
      membershipId: SEED_IDS.MEMBERSHIP_STAFF_2,
      profileId: SEED_IDS.STAFF_PROFILE_2,
      username: 'staff2',
      email: 'staff2@svm-ggn.edu.in',
      firstName: { en: 'Vikram', hi: 'विक्रम' },
      lastName: { en: 'Joshi', hi: 'जोशी' },
      employeeId: 'SVM/STAFF/002',
      designation: 'PRT English',
      employmentType: 'CONTRACTUAL',
      roleName: DefaultRoles.SubjectTeacher,
    },
    {
      userId: SEED_IDS.USER_STAFF_3,
      membershipId: SEED_IDS.MEMBERSHIP_STAFF_3,
      profileId: SEED_IDS.STAFF_PROFILE_3,
      username: 'staff3',
      email: 'staff3@svm-ggn.edu.in',
      firstName: { en: 'Meera', hi: 'मीरा' },
      lastName: { en: 'Nair', hi: 'नायर' },
      employeeId: 'SVM/STAFF/003',
      designation: 'Admin Officer',
      employmentType: 'REGULAR',
      roleName: DefaultRoles.AdminClerk,
    },
  ];

  const roleNames = [DefaultRoles.SubjectTeacher, DefaultRoles.AdminClerk];
  const roleRows = await tx
    .select({ id: roles.id, name: roles.name })
    .from(roles)
    .where(
      and(
        sql`${roles.tenantId} = ${instituteId}::uuid`,
        inArray(sql`${roles.name}->>'en'`, roleNames),
        isNull(roles.deletedAt),
      ),
    );
  const roleByName = new Map<string, string>(
    roleRows.map((r) => [(r.name as { en: string }).en, r.id]),
  );
  for (const name of roleNames) {
    if (!roleByName.has(name)) {
      throw new Error(`Role ${name} not found for institute ${instituteId} — run demo seed first`);
    }
  }

  const staffPassword = await hash(STAFF_PASSWORD_PLAIN);

  await tx
    .insert(users)
    .values(
      fixtures.map((s) => ({
        id: s.userId,
        username: s.username,
        email: s.email,
        passwordHash: staffPassword,
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
      fixtures.map((s) => {
        const roleId = roleByName.get(s.roleName);
        if (!roleId) throw new Error(`Role ${s.roleName} missing`);
        return {
          id: s.membershipId,
          userId: s.userId,
          tenantId: instituteId,
          roleId,
          ...BY,
        };
      }),
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
    .insert(staffProfiles)
    .values(
      fixtures.map((s) => ({
        id: s.profileId,
        userId: s.userId,
        membershipId: s.membershipId,
        tenantId: instituteId,
        employeeId: s.employeeId,
        designation: s.designation,
        employmentType: s.employmentType,
        dateOfJoining: '2022-04-01',
        ...BY,
      })),
    )
    .onConflictDoNothing({ target: staffProfiles.id });

  console.log('  E2E staff: staff2, staff3');
}
