import { UserIdentifierType } from '@roviq/common-types';
import { type DrizzleDB, mkInstituteCtx, phoneNumbersLive, withTenant } from '@roviq/database';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { formatDateDmy, fullName, genderLabel, groupBy, identifierMap } from './export-helpers';
import {
  type GuardianNameRow,
  guardianNames,
  type PersonIdentifierRow,
  parentsOf,
  personIdentifiers,
  type StudentYearRow,
  studentsInYear,
} from './students-for-year';

export interface CbseCandidateData {
  students: readonly StudentYearRow[];
  guardians: readonly GuardianNameRow[];
  identifiers: readonly PersonIdentifierRow[];
  /** Primary mobile number by user id, for students and their guardians only. */
  phones: ReadonlyMap<string, string>;
}

/** One CBSE candidate, ready to be laid out in a registration or LOC sheet. */
export interface CbseCandidate {
  udiseClassCode: number;
  nameCapitals: string;
  motherName: string;
  fatherOrGuardianName: string;
  dateOfBirth: string;
  gender: string;
  apaarId: string;
  registrationNumber: string;
  cwsnStatus: string;
  mobile: string;
}

/**
 * Students of the given UDISE+ classes in the year (Class 9 = 9), their parents, identifiers
 * and mobile numbers, all read as the institute.
 */
export async function fetchCbseCandidates(
  db: DrizzleDB,
  tenantId: string,
  academicYearId: string,
  udiseClassCodes: readonly number[],
  origin: `workflow:${string}`,
): Promise<CbseCandidateData> {
  return withTenant(db, mkInstituteCtx(tenantId, origin), async (tx) => {
    const data = {
      students: await studentsInYear(tx, academicYearId, udiseClassCodes),
      guardians: await guardianNames(tx),
      identifiers: await personIdentifiers(tx, [
        UserIdentifierType.APAAR,
        UserIdentifierType.CBSE_REGISTRATION,
      ]),
    };
    const studentIds = new Set(data.students.map((s) => s.id));
    const userIds = [
      ...new Set([
        ...data.students.map((s) => s.userId),
        ...data.guardians.filter((g) => studentIds.has(g.studentProfileId)).map((g) => g.userId),
      ]),
    ];
    const phoneRows =
      userIds.length === 0
        ? []
        : await tx
            .select({ userId: phoneNumbersLive.userId, number: phoneNumbersLive.number })
            .from(phoneNumbersLive)
            .where(
              and(inArray(phoneNumbersLive.userId, userIds), eq(phoneNumbersLive.isPrimary, true)),
            )
            .orderBy(desc(phoneNumbersLive.createdAt));
    const phones = new Map<string, string>();
    for (const row of phoneRows) {
      if (!phones.has(row.userId)) phones.set(row.userId, row.number);
    }
    return { ...data, phones };
  });
}

/** The candidates in sheet order, with every value in the format both CBSE sheets share. */
export function cbseCandidates(data: CbseCandidateData): CbseCandidate[] {
  const guardianMap = groupBy(data.guardians, (g) => g.studentProfileId);
  const apaarIds = identifierMap(data.identifiers, UserIdentifierType.APAAR);
  const registrationNumbers = identifierMap(data.identifiers, UserIdentifierType.CBSE_REGISTRATION);

  return data.students.flatMap((student) => {
    if (student.udiseClassCode === null) return [];
    const links = guardianMap.get(student.id) ?? [];
    const { father, mother } = parentsOf(links);
    const guardianPhone = [father, mother, ...links]
      .map((g) => (g ? data.phones.get(g.userId) : undefined))
      .find((phone) => phone !== undefined);
    return [
      {
        udiseClassCode: student.udiseClassCode,
        nameCapitals: fullName(student).toUpperCase(),
        motherName: mother ? fullName(mother) : '',
        fatherOrGuardianName: father ? fullName(father) : '',
        dateOfBirth: formatDateDmy(student.dateOfBirth),
        gender: genderLabel(student.gender),
        apaarId: apaarIds.get(student.userId) ?? '',
        registrationNumber: registrationNumbers.get(student.userId) ?? '',
        cwsnStatus: student.cwsnType ?? '',
        mobile: data.phones.get(student.userId) ?? guardianPhone ?? '',
      },
    ];
  });
}
