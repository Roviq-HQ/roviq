/**
 * UDISE+ DCF Export (ROV-171, ROV-296).
 *
 * - Sheet "Students": students enrolled in the chosen academic year (DCF 4.2 "Enrolment
 *   details of student in present school for current year")
 * - Sheet "Teachers": staff employed at any time in that year (DCF Section 3)
 *
 * Formats follow the UDISE+ Data Capture Format for Academic Year 2025-26 (Ministry of
 * Education): names in capital letters (4.1.1, 3.3.1), dates DD/MM/YYYY (4.1.3, 3.3.3),
 * minority "Not Applicable" when none (4.1.14). Aadhaar is never exported.
 * Every query runs as the institute (`withTenant`); no other institute's rows are read.
 */
import { QualificationType, UserIdentifierType } from '@roviq/common-types';
import { UDISE_STUDENT_HEADERS, UDISE_TEACHER_HEADERS } from '@roviq/compliance';
import { type DrizzleDB, mkInstituteCtx, withTenant } from '@roviq/database';
import * as XLSX from 'xlsx';
import {
  formatDateDmy,
  fullName,
  genderLabel,
  groupBy,
  identifierMap,
  minorityLabel,
  natureOfAppointment,
  resolveI18n,
  socialCategoryLabel,
  yesNo,
} from './export-helpers';
import {
  academicYearOf,
  latestQualification,
  type StaffQualificationRow,
  type StaffYearRow,
  staffEmployedDuring,
  staffQualifications,
} from './staff-for-year';
import {
  type GuardianNameRow,
  guardianNames,
  type PersonIdentifierRow,
  parentsOf,
  personIdentifiers,
  type StudentYearRow,
  studentsInYear,
} from './students-for-year';
import type { ComplianceExportOutput } from './types';

const ORIGIN = 'workflow:compliance-export-udise-dcf';

export interface UdiseDcfData {
  students: readonly StudentYearRow[];
  guardians: readonly GuardianNameRow[];
  identifiers: readonly PersonIdentifierRow[];
  staff: readonly StaffYearRow[];
  qualifications: readonly StaffQualificationRow[];
}

export async function generateUdiseDcfExport(
  db: DrizzleDB,
  tenantId: string,
  academicYearId: string,
): Promise<ComplianceExportOutput> {
  const data = await withTenant(
    db,
    mkInstituteCtx(tenantId, ORIGIN),
    async (tx): Promise<UdiseDcfData> => {
      const year = await academicYearOf(tx, academicYearId);
      return {
        students: await studentsInYear(tx, academicYearId),
        guardians: await guardianNames(tx),
        identifiers: await personIdentifiers(tx, [
          UserIdentifierType.APAAR,
          UserIdentifierType.PEN,
        ]),
        staff: await staffEmployedDuring(tx, year),
        qualifications: await staffQualifications(tx),
      };
    },
  );
  return buildUdiseDcf(data);
}

export function buildUdiseDcf(data: UdiseDcfData): ComplianceExportOutput {
  const guardianMap = groupBy(data.guardians, (g) => g.studentProfileId);
  const apaarIds = identifierMap(data.identifiers, UserIdentifierType.APAAR);
  const pens = identifierMap(data.identifiers, UserIdentifierType.PEN);

  const studentRows = data.students.map((student) => {
    const { father, mother } = parentsOf(guardianMap.get(student.id) ?? []);
    return {
      'Student Name': fullName(student).toUpperCase(),
      "Father's Name": father ? fullName(father) : '',
      "Mother's Name": mother ? fullName(mother) : '',
      'Date of Birth': formatDateDmy(student.dateOfBirth),
      Gender: genderLabel(student.gender),
      'Aadhaar Number': '',
      'Mother Tongue': student.motherTongue ?? '',
      'Social Category': socialCategoryLabel(student.socialCategory),
      'Minority Status': minorityLabel(student.minorityType),
      'Is BPL': yesNo(student.isBpl),
      'Is CWSN': yesNo(student.isCwsn),
      'CWSN Type': student.cwsnType ?? '',
      'RTE Admitted': yesNo(student.isRteAdmitted),
      Class: resolveI18n(student.standardName),
      Section: resolveI18n(student.sectionName),
      'Admission Number': student.admissionNumber,
      Stream: student.stream ?? '',
      'Medium of Instruction': student.mediumOfInstruction ?? '',
      'Previous Year Status': '',
      'APAAR ID': apaarIds.get(student.userId) ?? '',
      PEN: pens.get(student.userId) ?? '',
    };
  });

  const qualMap = groupBy(data.qualifications, (q) => q.staffProfileId);
  const teacherRows = data.staff.map((staff) => {
    const quals = qualMap.get(staff.id) ?? [];
    return {
      'Teacher Name': fullName(staff).toUpperCase(),
      'Aadhaar Number': '',
      'Date of Birth': formatDateDmy(staff.dateOfBirth),
      Gender: genderLabel(staff.gender),
      'Social Category': socialCategoryLabel(staff.socialCategory),
      'Nature of Appointment': natureOfAppointment(staff),
      'Date of Joining': formatDateDmy(staff.dateOfJoining),
      'Academic Qualification':
        latestQualification(quals, QualificationType.ACADEMIC)?.degreeName ?? '',
      'Professional Qualification':
        latestQualification(quals, QualificationType.PROFESSIONAL)?.degreeName ?? '',
      'Trained for CWSN': yesNo(staff.trainedForCwsn),
      'Is Disabled': yesNo(staff.isDisabled),
      'Current Post Held': staff.designation ?? '',
    };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(studentRows, { header: UDISE_STUDENT_HEADERS }),
    'Students',
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(teacherRows, { header: UDISE_TEACHER_HEADERS }),
    'Teachers',
  );

  return {
    buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    rowCount: studentRows.length + teacherRows.length,
  };
}
