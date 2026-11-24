import {
  type DrizzleDB,
  memberships,
  rolesLive,
  studentAcademics,
  studentProfiles,
  tenantSequences,
} from '@roviq/database';
import { and, eq, sql } from 'drizzle-orm';
import {
  ensureTenantUserProfile,
  type TenantUserProfileFields,
} from '../../../auth/tenant-user-profile';
import { nextAdmissionNumber } from '../admission-number.sequence';
import { findYearAndClass, findYearAndStandard } from './class-lookup';
import type { AdmissionClassData, AdmissionClassResult, NewStudentProfileData } from './types';

export interface AdmitStudentData extends Omit<AdmissionClassData, 'sectionId'> {
  /** Null admits the student to the standard with no section and no enrolment row yet. */
  sectionId: string | null;
  tenantId: string;
  /** A new account, made just before; it has no membership yet. */
  userId: string;
  actorId: string;
  /** The institute's own record of the person (name and demographics). */
  tenantProfile: TenantUserProfileFields;
  profile: Omit<NewStudentProfileData, 'userId' | 'membershipId' | 'standardId' | 'actorId'>;
  /** A number the institute already gave the student; otherwise the next in the series. */
  admissionNumber?: string | null;
  /** Give the student the next roll number of the section in the year. */
  assignRollNumber?: boolean;
}

export type AdmitStudentResult =
  | Exclude<AdmissionClassResult, { kind: 'ok' }>
  | { kind: 'role_not_found' }
  | { kind: 'ok'; membershipId: string; studentProfileId: string; admissionNumber: string };

/**
 * Every institute-side row of a new student: membership, the institute's profile copy, the
 * student profile with its admission number, and the enrolment. Run inside one `withTenant`
 * transaction: a failure anywhere rolls all of it back, the admission counter included.
 * The class is looked up again here because it can be deleted after the caller's first check.
 */
export async function admitStudent(
  tx: DrizzleDB,
  data: AdmitStudentData,
): Promise<AdmitStudentResult> {
  const { tenantId, userId, actorId } = data;
  const found = data.sectionId
    ? await findYearAndClass(tx, data.academicYearId, data.standardId, data.sectionId)
    : await findYearAndStandard(tx, data.academicYearId, data.standardId);
  if (found.kind !== 'ok') return found;

  const roleId = await findStudentRoleId(tx, tenantId);
  if (!roleId) return { kind: 'role_not_found' };

  const [membership] = await tx
    .insert(memberships)
    .values({
      userId,
      tenantId,
      roleId,
      status: 'ACTIVE',
      abilities: [],
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning({ id: memberships.id });
  await ensureTenantUserProfile(tx, { tenantId, userId, actorId, ...data.tenantProfile });

  const admissionNumber =
    data.admissionNumber ?? (await nextAdmissionNumber(tx, tenantId, data.standardId));
  const [profile] = await tx
    .insert(studentProfiles)
    .values({
      ...data.profile,
      userId,
      membershipId: membership.id,
      tenantId,
      admissionNumber,
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning({ id: studentProfiles.id });

  if (data.sectionId) {
    const rollNumber = data.assignRollNumber
      ? await nextRollNumber(tx, tenantId, data.sectionId, data.academicYearId)
      : null;
    await tx.insert(studentAcademics).values({
      studentProfileId: profile.id,
      academicYearId: data.academicYearId,
      standardId: data.standardId,
      sectionId: data.sectionId,
      rollNumber,
      tenantId,
      createdBy: actorId,
      updatedBy: actorId,
    });
  }

  return {
    kind: 'ok',
    membershipId: membership.id,
    studentProfileId: profile.id,
    admissionNumber,
  };
}

/** The institute's student role, or null when the institute has none. */
export async function findStudentRoleId(tx: DrizzleDB, tenantId: string): Promise<string | null> {
  const [role] = await tx
    .select({ id: rolesLive.id })
    .from(rolesLive)
    .where(
      and(
        eq(rolesLive.tenantId, tenantId),
        sql`${rolesLive.name}->>'en' = 'student' OR ${rolesLive.name}->>'en' = 'Student'`,
      ),
    )
    .limit(1);
  return role?.id ?? null;
}

/** The next roll number of a section in a year, from the tenant's sequence for it. */
async function nextRollNumber(
  tx: DrizzleDB,
  tenantId: string,
  sectionId: string,
  academicYearId: string,
): Promise<string> {
  const sequenceName = `roll_no:${sectionId}:${academicYearId}`;
  await tx
    .insert(tenantSequences)
    .values({ tenantId, sequenceName, currentValue: 0n, formatTemplate: '{value:04d}' })
    .onConflictDoNothing();
  const result = await tx.execute(
    sql`SELECT * FROM next_sequence_value(${tenantId}::uuid, ${sequenceName})`,
  );
  const row = result.rows[0] as { next_val: string; formatted: string };
  return row.formatted || String(row.next_val);
}
