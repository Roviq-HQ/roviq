// libs/database/src/seed/demo/users.ts
import { hash } from '@node-rs/argon2';
import {
  DEFAULT_PRIMARY_NAV_SLUGS,
  DEFAULT_ROLE_ABILITIES,
  type DefaultRole,
  DefaultRoles,
} from '@roviq/common-types';
import {
  authProviders,
  guardianProfiles,
  memberships,
  platformMemberships,
  resellerMemberships,
  roles,
  SYSTEM_USER_ID,
  studentGuardianLinks,
  studentProfiles,
  userProfiles,
  users,
} from '../..';
import type { DrizzleDB } from '../../providers';
import { SEED_CREDENTIALS } from '../fixtures';
import { SEED_IDS } from '../ids';

const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

export async function seedInstituteRoles(tx: DrizzleDB, inst1Id: string, inst2Id: string) {
  const roleIds: Partial<Record<DefaultRole, string>> = {};
  const roleIds2: Partial<Record<DefaultRole, string>> = {};

  for (const [, roleName] of Object.entries(DefaultRoles)) {
    const abilities = DEFAULT_ROLE_ABILITIES[roleName];
    // Spread to a mutable array — the shared map exposes `readonly NavSlug[]`.
    const primaryNavSlugs = [...(DEFAULT_PRIMARY_NAV_SLUGS[roleName] ?? [])];

    const [role] = await tx
      .insert(roles)
      .values({
        tenantId: inst1Id,
        scope: 'institute',
        name: { en: roleName },
        abilities: JSON.parse(JSON.stringify(abilities)),
        primaryNavSlugs,
        isDefault: true,
        ...BY,
      })
      .onConflictDoUpdate({
        target: [roles.tenantId, roles.name],
        set: { updatedAt: new Date(), primaryNavSlugs },
      })
      .returning();
    roleIds[roleName] = role.id;

    const [role2] = await tx
      .insert(roles)
      .values({
        tenantId: inst2Id,
        scope: 'institute',
        name: { en: roleName },
        abilities: JSON.parse(JSON.stringify(abilities)),
        primaryNavSlugs,
        isDefault: true,
        ...BY,
      })
      .onConflictDoUpdate({
        target: [roles.tenantId, roles.name],
        set: { updatedAt: new Date(), primaryNavSlugs },
      })
      .returning();
    roleIds2[roleName] = role2.id;
  }

  return { roleIds, roleIds2 };
}

export async function seedUsersAndMemberships(
  tx: DrizzleDB,
  inst1Id: string,
  inst2Id: string,
  roleIds: Partial<Record<DefaultRole, string>>,
  roleIds2: Partial<Record<DefaultRole, string>>,
) {
  function requireRole(ids: typeof roleIds, role: DefaultRole): string {
    const id = ids[role];
    if (!id) throw new Error(`Role "${role}" not found in seeded roles`);
    return id;
  }

  const adminPassword = await hash(SEED_CREDENTIALS.ADMIN.password);
  const resellerPassword = await hash(SEED_CREDENTIALS.RESELLER.password);
  const teacherPassword = await hash(SEED_CREDENTIALS.TEACHER.password);
  const studentPassword = await hash(SEED_CREDENTIALS.STUDENT.password);
  const guardianPassword = await hash(SEED_CREDENTIALS.GUARDIAN.password);

  const [admin] = await tx
    .insert(users)
    .values({
      id: SEED_IDS.USER_ADMIN,
      username: SEED_CREDENTIALS.ADMIN.username,
      email: 'admin@svm-ggn.edu.in',
      passwordHash: adminPassword,
    })
    .onConflictDoUpdate({ target: users.username, set: { updatedAt: new Date() } })
    .returning();
  const [teacher] = await tx
    .insert(users)
    .values({
      id: SEED_IDS.USER_TEACHER,
      username: SEED_CREDENTIALS.TEACHER.username,
      email: 'teacher1@svm-ggn.edu.in',
      passwordHash: teacherPassword,
    })
    .onConflictDoUpdate({ target: users.username, set: { updatedAt: new Date() } })
    .returning();
  const [student] = await tx
    .insert(users)
    .values({
      id: SEED_IDS.USER_STUDENT,
      username: SEED_CREDENTIALS.STUDENT.username,
      email: 'student1@svm-ggn.edu.in',
      passwordHash: studentPassword,
    })
    .onConflictDoUpdate({ target: users.username, set: { updatedAt: new Date() } })
    .returning();
  const [resellerUser] = await tx
    .insert(users)
    .values({
      id: SEED_IDS.USER_RESELLER,
      username: SEED_CREDENTIALS.RESELLER.username,
      email: 'reseller1@roviq.com',
      passwordHash: resellerPassword,
    })
    .onConflictDoUpdate({ target: users.username, set: { updatedAt: new Date() } })
    .returning();

  const [guardianUser] = await tx
    .insert(users)
    .values({
      id: SEED_IDS.USER_GUARDIAN,
      username: SEED_CREDENTIALS.GUARDIAN.username,
      email: 'guardian1@svm-ggn.edu.in',
      passwordHash: guardianPassword,
    })
    .onConflictDoUpdate({ target: users.username, set: { updatedAt: new Date() } })
    .returning();

  // ── User profiles (needed by myProfile resolver + profile page) ──
  for (const { userId, firstName, lastName, gender } of [
    { userId: admin.id, firstName: { en: 'Admin' }, lastName: { en: 'Roviq' }, gender: 'MALE' },
    { userId: teacher.id, firstName: { en: 'Rajesh' }, lastName: { en: 'Sharma' }, gender: 'MALE' },
    { userId: student.id, firstName: { en: 'Priya' }, lastName: { en: 'Singh' }, gender: 'FEMALE' },
    {
      userId: guardianUser.id,
      firstName: { en: 'Suresh' },
      lastName: { en: 'Kumar' },
      gender: 'MALE',
    },
    {
      userId: resellerUser.id,
      firstName: { en: 'Reseller' },
      lastName: { en: 'One' },
      gender: 'MALE',
    },
  ] as const) {
    await tx
      .insert(userProfiles)
      .values({ userId, firstName, lastName, gender, ...BY })
      .onConflictDoNothing();
  }

  // admin — member of BOTH institutes + platform admin
  await tx
    .insert(memberships)
    .values({
      id: SEED_IDS.MEMBERSHIP_ADMIN_INST1,
      userId: admin.id,
      tenantId: inst1Id,
      roleId: requireRole(roleIds, 'institute_admin'),
      ...BY,
    })
    .onConflictDoUpdate({
      target: [memberships.userId, memberships.tenantId, memberships.roleId],
      set: { updatedAt: new Date() },
    });
  await tx
    .insert(memberships)
    .values({
      id: SEED_IDS.MEMBERSHIP_ADMIN_INST2,
      userId: admin.id,
      tenantId: inst2Id,
      roleId: requireRole(roleIds2, 'institute_admin'),
      ...BY,
    })
    .onConflictDoUpdate({
      target: [memberships.userId, memberships.tenantId, memberships.roleId],
      set: { updatedAt: new Date() },
    });
  await tx
    .insert(platformMemberships)
    .values({ userId: admin.id, roleId: SEED_IDS.ROLE_PLATFORM_ADMIN })
    .onConflictDoUpdate({ target: platformMemberships.userId, set: { updatedAt: new Date() } });

  // reseller
  await tx
    .insert(resellerMemberships)
    .values({
      userId: resellerUser.id,
      resellerId: SEED_IDS.RESELLER_DIRECT,
      roleId: SEED_IDS.ROLE_RESELLER_FULL_ADMIN,
    })
    .onConflictDoUpdate({
      target: [resellerMemberships.userId, resellerMemberships.resellerId],
      set: { updatedAt: new Date() },
    });

  // teacher — single institute
  await tx
    .insert(memberships)
    .values({
      id: SEED_IDS.MEMBERSHIP_TEACHER_INST1,
      userId: teacher.id,
      tenantId: inst1Id,
      roleId: requireRole(roleIds, 'class_teacher'),
      ...BY,
    })
    .onConflictDoUpdate({
      target: [memberships.userId, memberships.tenantId, memberships.roleId],
      set: { updatedAt: new Date() },
    });

  // student — single institute
  await tx
    .insert(memberships)
    .values({
      id: SEED_IDS.MEMBERSHIP_STUDENT_INST1,
      userId: student.id,
      tenantId: inst1Id,
      roleId: requireRole(roleIds, 'student'),
      ...BY,
    })
    .onConflictDoUpdate({
      target: [memberships.userId, memberships.tenantId, memberships.roleId],
      set: { updatedAt: new Date() },
    });

  // guardian — parent role, linked to student1
  await tx
    .insert(memberships)
    .values({
      id: SEED_IDS.MEMBERSHIP_GUARDIAN_INST1,
      userId: guardianUser.id,
      tenantId: inst1Id,
      roleId: requireRole(roleIds, 'parent'),
      ...BY,
    })
    .onConflictDoUpdate({
      target: [memberships.userId, memberships.tenantId, memberships.roleId],
      set: { updatedAt: new Date() },
    });

  // Student profile for student1 (needed for guardian link)
  await tx
    .insert(studentProfiles)
    .values({
      id: SEED_IDS.STUDENT_PROFILE_1,
      userId: student.id,
      membershipId: SEED_IDS.MEMBERSHIP_STUDENT_INST1,
      tenantId: inst1Id,
      admissionNumber: 'S-2026/0001',
      admissionDate: '2026-04-01',
      admissionClass: 'Nursery',
      ...BY,
    })
    .onConflictDoNothing();

  // Guardian profile for guardian1
  await tx
    .insert(guardianProfiles)
    .values({
      id: SEED_IDS.GUARDIAN_PROFILE_1,
      userId: guardianUser.id,
      membershipId: SEED_IDS.MEMBERSHIP_GUARDIAN_INST1,
      tenantId: inst1Id,
      occupation: 'Engineer',
      organization: 'Tata Consultancy Services',
      ...BY,
    })
    .onConflictDoNothing();

  // Link guardian to student
  await tx
    .insert(studentGuardianLinks)
    .values({
      tenantId: inst1Id,
      studentProfileId: SEED_IDS.STUDENT_PROFILE_1,
      guardianProfileId: SEED_IDS.GUARDIAN_PROFILE_1,
      relationship: 'FATHER',
      isPrimaryContact: true,
      isEmergencyContact: true,
    })
    .onConflictDoNothing();

  // Auth providers (password-based)
  for (const user of [admin, teacher, student, resellerUser, guardianUser]) {
    await tx
      .insert(authProviders)
      .values({ userId: user.id, provider: 'password', providerUserId: user.id })
      .onConflictDoUpdate({
        target: [authProviders.provider, authProviders.providerUserId],
        set: { updatedAt: new Date() },
      });
  }
}
