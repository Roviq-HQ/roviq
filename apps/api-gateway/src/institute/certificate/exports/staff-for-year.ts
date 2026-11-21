import {
  academicYearsLive,
  type DrizzleDB,
  staffProfilesLive,
  staffQualificationsLive,
  userProfilesLive,
} from '@roviq/database';
import { and, asc, eq, gte, isNull, lte, or } from 'drizzle-orm';

export interface StaffQualificationRow {
  staffProfileId: string;
  type: (typeof staffQualificationsLive.$inferSelect)['type'];
  degreeName: string;
  yearOfPassing: number | null;
}

export type StaffYearRow = Awaited<ReturnType<typeof staffEmployedDuring>>[number];

/** The academic year, or an error: an export of a year the institute does not have is a bug. */
export async function academicYearOf(tx: DrizzleDB, academicYearId: string) {
  const [year] = await tx
    .select({
      label: academicYearsLive.label,
      startDate: academicYearsLive.startDate,
      endDate: academicYearsLive.endDate,
    })
    .from(academicYearsLive)
    .where(eq(academicYearsLive.id, academicYearId));
  if (!year) throw new Error(`Academic year ${academicYearId} not found for this institute`);
  return year;
}

/**
 * Staff employed at any time between the year's start and end, with their profile, ordered
 * by employee ID. Run inside `withTenant`: RLS keeps it to the one institute.
 */
export function staffEmployedDuring(tx: DrizzleDB, year: { startDate: string; endDate: string }) {
  return tx
    .select({
      id: staffProfilesLive.id,
      userId: staffProfilesLive.userId,
      employeeId: staffProfilesLive.employeeId,
      designation: staffProfilesLive.designation,
      department: staffProfilesLive.department,
      specialization: staffProfilesLive.specialization,
      natureOfAppointment: staffProfilesLive.natureOfAppointment,
      employmentType: staffProfilesLive.employmentType,
      dateOfJoining: staffProfilesLive.dateOfJoining,
      dateOfLeaving: staffProfilesLive.dateOfLeaving,
      socialCategory: staffProfilesLive.socialCategory,
      trainedForCwsn: staffProfilesLive.trainedForCwsn,
      isDisabled: staffProfilesLive.isDisabled,
      disabilityType: staffProfilesLive.disabilityType,
      firstName: userProfilesLive.firstName,
      lastName: userProfilesLive.lastName,
      gender: userProfilesLive.gender,
      dateOfBirth: userProfilesLive.dateOfBirth,
    })
    .from(staffProfilesLive)
    .leftJoin(userProfilesLive, eq(userProfilesLive.userId, staffProfilesLive.userId))
    .where(
      and(
        or(
          isNull(staffProfilesLive.dateOfJoining),
          lte(staffProfilesLive.dateOfJoining, year.endDate),
        ),
        or(
          isNull(staffProfilesLive.dateOfLeaving),
          gte(staffProfilesLive.dateOfLeaving, year.startDate),
        ),
      ),
    )
    .orderBy(asc(staffProfilesLive.employeeId), asc(staffProfilesLive.id));
}

/** Every qualification of the institute's staff. Run inside `withTenant`. */
export function staffQualifications(tx: DrizzleDB): Promise<StaffQualificationRow[]> {
  return tx
    .select({
      staffProfileId: staffQualificationsLive.staffProfileId,
      type: staffQualificationsLive.type,
      degreeName: staffQualificationsLive.degreeName,
      yearOfPassing: staffQualificationsLive.yearOfPassing,
    })
    .from(staffQualificationsLive);
}

/** The most recent qualification of a type stands in for the highest one. */
export function latestQualification(
  quals: readonly StaffQualificationRow[],
  type: StaffQualificationRow['type'],
): StaffQualificationRow | null {
  return (
    quals
      .filter((q) => q.type === type)
      .sort((a, b) => (b.yearOfPassing ?? 0) - (a.yearOfPassing ?? 0))[0] ?? null
  );
}
