/**
 * Admission Register (AWR) Export (ROV-171, ROV-296).
 *
 * Students admitted during the chosen academic year (admission date between its start and
 * end), by admission number, with the class and section they hold in that year. No official
 * definition of the register was found, so "in that academic year" means by admission date.
 */
import {
  type DrizzleDB,
  mkInstituteCtx,
  sectionsLive,
  standardsLive,
  studentAcademicsLive,
  studentProfilesLive,
  tenantUserProfilesLive,
  withTenant,
} from '@roviq/database';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import {
  formatDateDmy,
  fullName,
  genderLabel,
  resolveI18n,
  socialCategoryLabel,
} from './export-helpers';
import { academicYearOf } from './staff-for-year';
import type { ComplianceExportOutput } from './types';

export const AWR_HEADERS = [
  'S.No.',
  'Admission Number',
  'Student Name',
  'Date of Birth',
  'Gender',
  'Admission Date',
  'Admission Class',
  'Admission Type',
  'Academic Status',
  'Social Category',
  'Class',
  'Section',
];

const ORIGIN = 'workflow:compliance-export-awr';

function admittedDuring(tx: DrizzleDB, year: { id: string; startDate: string; endDate: string }) {
  return tx
    .select({
      admissionNumber: studentProfilesLive.admissionNumber,
      admissionDate: studentProfilesLive.admissionDate,
      admissionClass: studentProfilesLive.admissionClass,
      admissionType: studentProfilesLive.admissionType,
      academicStatus: studentProfilesLive.academicStatus,
      socialCategory: studentProfilesLive.socialCategory,
      firstName: tenantUserProfilesLive.firstName,
      lastName: tenantUserProfilesLive.lastName,
      gender: tenantUserProfilesLive.gender,
      dateOfBirth: tenantUserProfilesLive.dateOfBirth,
      standardName: standardsLive.name,
      sectionName: sectionsLive.name,
    })
    .from(studentProfilesLive)
    .leftJoin(
      tenantUserProfilesLive,
      and(
        eq(tenantUserProfilesLive.userId, studentProfilesLive.userId),
        eq(tenantUserProfilesLive.tenantId, studentProfilesLive.tenantId),
      ),
    )
    .leftJoin(
      studentAcademicsLive,
      and(
        eq(studentAcademicsLive.studentProfileId, studentProfilesLive.id),
        eq(studentAcademicsLive.academicYearId, year.id),
      ),
    )
    .leftJoin(standardsLive, eq(standardsLive.id, studentAcademicsLive.standardId))
    .leftJoin(sectionsLive, eq(sectionsLive.id, studentAcademicsLive.sectionId))
    .where(
      and(
        gte(studentProfilesLive.admissionDate, year.startDate),
        lte(studentProfilesLive.admissionDate, year.endDate),
      ),
    )
    .orderBy(asc(studentProfilesLive.admissionNumber));
}

export type AwrRow = Awaited<ReturnType<typeof admittedDuring>>[number];

export async function generateAwrExport(
  db: DrizzleDB,
  tenantId: string,
  academicYearId: string,
): Promise<ComplianceExportOutput> {
  const students = await withTenant(db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
    const year = await academicYearOf(tx, academicYearId);
    return admittedDuring(tx, { id: academicYearId, ...year });
  });
  return buildAwr(students);
}

export function buildAwr(students: readonly AwrRow[]): ComplianceExportOutput {
  const rows = students.map((student, index) => ({
    'S.No.': index + 1,
    'Admission Number': student.admissionNumber,
    'Student Name': fullName(student),
    'Date of Birth': formatDateDmy(student.dateOfBirth),
    Gender: genderLabel(student.gender),
    'Admission Date': formatDateDmy(student.admissionDate),
    'Admission Class': student.admissionClass ?? '',
    'Admission Type': student.admissionType,
    'Academic Status': student.academicStatus,
    'Social Category': socialCategoryLabel(student.socialCategory),
    Class: resolveI18n(student.standardName),
    Section: resolveI18n(student.sectionName),
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(rows, { header: AWR_HEADERS }),
    'Admission Register',
  );
  return {
    buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    rowCount: rows.length,
  };
}
