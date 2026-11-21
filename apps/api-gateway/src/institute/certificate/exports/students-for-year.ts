import { GuardianRelationship, type UserIdentifierType } from '@roviq/common-types';
import {
  type DrizzleDB,
  guardianProfilesLive,
  sectionsLive,
  standardsLive,
  studentAcademicsLive,
  studentGuardianLinksLive,
  studentProfilesLive,
  userIdentifiersLive,
  userProfilesLive,
} from '@roviq/database';
import { and, asc, eq, inArray } from 'drizzle-orm';

/**
 * Students with an academic record in the year, with profile, class and section, ordered by
 * class then admission number. Run inside `withTenant`: RLS keeps every joined table to the
 * one institute. `udiseClassCodes` keeps only those classes (UDISE+ codes, Class 9 = 9).
 */
export function studentsInYear(
  tx: DrizzleDB,
  academicYearId: string,
  udiseClassCodes?: readonly number[],
) {
  return tx
    .select({
      id: studentProfilesLive.id,
      userId: studentProfilesLive.userId,
      admissionNumber: studentProfilesLive.admissionNumber,
      admissionDate: studentProfilesLive.admissionDate,
      admissionClass: studentProfilesLive.admissionClass,
      admissionType: studentProfilesLive.admissionType,
      academicStatus: studentProfilesLive.academicStatus,
      socialCategory: studentProfilesLive.socialCategory,
      caste: studentProfilesLive.caste,
      minorityType: studentProfilesLive.minorityType,
      isBpl: studentProfilesLive.isBpl,
      isCwsn: studentProfilesLive.isCwsn,
      cwsnType: studentProfilesLive.cwsnType,
      isRteAdmitted: studentProfilesLive.isRteAdmitted,
      stream: studentProfilesLive.stream,
      firstName: userProfilesLive.firstName,
      lastName: userProfilesLive.lastName,
      gender: userProfilesLive.gender,
      dateOfBirth: userProfilesLive.dateOfBirth,
      motherTongue: userProfilesLive.motherTongue,
      rollNumber: studentAcademicsLive.rollNumber,
      standardId: studentAcademicsLive.standardId,
      standardName: standardsLive.name,
      udiseClassCode: standardsLive.udiseClassCode,
      sectionName: sectionsLive.name,
      mediumOfInstruction: sectionsLive.mediumOfInstruction,
    })
    .from(studentAcademicsLive)
    .innerJoin(
      studentProfilesLive,
      eq(studentProfilesLive.id, studentAcademicsLive.studentProfileId),
    )
    .leftJoin(userProfilesLive, eq(userProfilesLive.userId, studentProfilesLive.userId))
    .innerJoin(standardsLive, eq(standardsLive.id, studentAcademicsLive.standardId))
    .leftJoin(sectionsLive, eq(sectionsLive.id, studentAcademicsLive.sectionId))
    .where(
      and(
        eq(studentAcademicsLive.academicYearId, academicYearId),
        udiseClassCodes ? inArray(standardsLive.udiseClassCode, [...udiseClassCodes]) : undefined,
      ),
    )
    .orderBy(asc(standardsLive.numericOrder), asc(studentProfilesLive.admissionNumber));
}

export type StudentYearRow = Awaited<ReturnType<typeof studentsInYear>>[number];

/** Guardians linked to this institute's students, with names. Run inside `withTenant`. */
export function guardianNames(tx: DrizzleDB) {
  return tx
    .select({
      studentProfileId: studentGuardianLinksLive.studentProfileId,
      relationship: studentGuardianLinksLive.relationship,
      userId: guardianProfilesLive.userId,
      firstName: userProfilesLive.firstName,
      lastName: userProfilesLive.lastName,
    })
    .from(studentGuardianLinksLive)
    .innerJoin(
      guardianProfilesLive,
      eq(studentGuardianLinksLive.guardianProfileId, guardianProfilesLive.id),
    )
    .innerJoin(userProfilesLive, eq(guardianProfilesLive.userId, userProfilesLive.userId));
}

export type GuardianNameRow = Awaited<ReturnType<typeof guardianNames>>[number];

/**
 * Identifiers of the given types. Run inside `withTenant`: RLS returns only people who are
 * members of this institute. Never ask for AADHAAR or PAN here.
 */
export function personIdentifiers(
  tx: DrizzleDB,
  types: readonly Exclude<UserIdentifierType, 'AADHAAR' | 'PAN'>[],
) {
  return tx
    .select({
      userId: userIdentifiersLive.userId,
      type: userIdentifiersLive.type,
      valuePlain: userIdentifiersLive.valuePlain,
      valueMasked: userIdentifiersLive.valueMasked,
    })
    .from(userIdentifiersLive)
    .where(inArray(userIdentifiersLive.type, [...types]));
}

export type PersonIdentifierRow = Awaited<ReturnType<typeof personIdentifiers>>[number];

/** Father (or legal guardian) and mother of a student, from the institute's guardian links. */
export function parentsOf(links: readonly GuardianNameRow[]): {
  father: GuardianNameRow | null;
  mother: GuardianNameRow | null;
} {
  return {
    father:
      links.find(
        (g) =>
          g.relationship === GuardianRelationship.FATHER ||
          g.relationship === GuardianRelationship.LEGAL_GUARDIAN,
      ) ?? null,
    mother: links.find((g) => g.relationship === GuardianRelationship.MOTHER) ?? null,
  };
}
