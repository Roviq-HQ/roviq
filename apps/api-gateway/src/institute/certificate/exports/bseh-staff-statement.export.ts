/**
 * BSEH (Board of School Education Haryana) Staff Statement Export (ROV-296).
 *
 * One row per staff member employed at any time in the academic year, for the board's
 * annual faculty verification. The board's own template is not in the repository: these
 * columns are the data Roviq holds, labelled plainly, until the product owner confirms the
 * official layout.
 */
import { BoardType, QualificationType } from '@roviq/common-types';
import {
  type DrizzleDB,
  instituteAffiliationsLive,
  institutesLive,
  mkInstituteCtx,
  withTenant,
} from '@roviq/database';
import { eq } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import {
  employmentTypeLabel,
  formatDateDmy,
  fullName,
  genderLabel,
  groupBy,
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
import type { ComplianceExportOutput } from './types';

export const BSEH_STAFF_HEADERS = [
  'S.No.',
  'Employee ID',
  'Staff Name',
  'Gender',
  'Date of Birth',
  'Designation',
  'Department',
  'Subject Specialisation',
  'Nature of Appointment',
  'Employment Type',
  'Date of Joining',
  'Date of Leaving',
  'Social Category',
  'Highest Academic Qualification',
  'Academic Qualification Year',
  'Professional Qualification',
  'Trained for CWSN',
  'Person with Disability',
  'Disability Type',
];

const INSTITUTE_HEADERS = ['Field', 'Value'];

const ORIGIN = 'workflow:compliance-export-bseh-staff-statement';

export interface BsehStaffStatementData {
  instituteName: Record<string, string> | null;
  affiliationNumber: string | null;
  yearLabel: string;
  staff: readonly StaffYearRow[];
  qualifications: readonly StaffQualificationRow[];
}

export async function generateBsehStaffStatementExport(
  db: DrizzleDB,
  tenantId: string,
  academicYearId: string,
): Promise<ComplianceExportOutput> {
  const data = await withTenant(db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
    const year = await academicYearOf(tx, academicYearId);
    const [institute] = await tx
      .select({ name: institutesLive.name })
      .from(institutesLive)
      .where(eq(institutesLive.id, tenantId));
    const [affiliation] = await tx
      .select({ affiliationNumber: instituteAffiliationsLive.affiliationNumber })
      .from(instituteAffiliationsLive)
      .where(eq(instituteAffiliationsLive.board, BoardType.BSEH));
    return {
      instituteName: institute?.name ?? null,
      affiliationNumber: affiliation?.affiliationNumber ?? null,
      yearLabel: year.label,
      staff: await staffEmployedDuring(tx, year),
      qualifications: await staffQualifications(tx),
    };
  });
  return buildBsehStaffStatement(data);
}

export function buildBsehStaffStatement(data: BsehStaffStatementData): ComplianceExportOutput {
  const qualMap = groupBy(data.qualifications, (q) => q.staffProfileId);

  const rows = data.staff.map((staff, index) => {
    const quals = qualMap.get(staff.id) ?? [];
    const academic = latestQualification(quals, QualificationType.ACADEMIC);
    const professional = latestQualification(quals, QualificationType.PROFESSIONAL);
    return {
      'S.No.': index + 1,
      'Employee ID': staff.employeeId ?? '',
      'Staff Name': fullName(staff),
      Gender: genderLabel(staff.gender),
      'Date of Birth': formatDateDmy(staff.dateOfBirth),
      Designation: staff.designation ?? '',
      Department: staff.department ?? '',
      'Subject Specialisation': staff.specialization ?? '',
      'Nature of Appointment': natureOfAppointment(staff),
      'Employment Type': employmentTypeLabel(staff.employmentType),
      'Date of Joining': formatDateDmy(staff.dateOfJoining),
      'Date of Leaving': formatDateDmy(staff.dateOfLeaving),
      'Social Category': socialCategoryLabel(staff.socialCategory),
      'Highest Academic Qualification': academic?.degreeName ?? '',
      'Academic Qualification Year': academic?.yearOfPassing ?? '',
      'Professional Qualification': professional?.degreeName ?? '',
      'Trained for CWSN': yesNo(staff.trainedForCwsn),
      'Person with Disability': yesNo(staff.isDisabled),
      'Disability Type': staff.disabilityType ?? '',
    };
  });

  const instituteRows = [
    { Field: 'Institute Name', Value: resolveI18n(data.instituteName) },
    { Field: 'BSEH Affiliation Number', Value: data.affiliationNumber ?? '' },
    { Field: 'Academic Year', Value: data.yearLabel },
    { Field: 'Staff Count', Value: rows.length },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(rows, { header: BSEH_STAFF_HEADERS }),
    'Staff Statement',
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(instituteRows, { header: INSTITUTE_HEADERS }),
    'Institute',
  );

  return {
    buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    rowCount: rows.length,
  };
}
