/**
 * Shala Darpan (Rajasthan) Export (ROV-296).
 *
 * The student and staff return for the Rajasthan education department's portal:
 * - Sheet "Students": every student with an academic record in the year
 * - Sheet "Staff": staff employed at any time in the year
 * - Sheet "Institute": the institute's Shala Darpan ID and UDISE+ code
 *
 * The portal's own upload template is not in the repository: these columns are the data
 * Roviq holds, labelled plainly, until the product owner confirms the official layout.
 */
import {
  InstituteIdentifierType,
  QualificationType,
  UserIdentifierType,
} from '@roviq/common-types';
import {
  type DrizzleDB,
  instituteIdentifiersLive,
  institutesLive,
  mkInstituteCtx,
  withTenant,
} from '@roviq/database';
import { eq, inArray } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import {
  formatDateDmy,
  fullName,
  genderLabel,
  groupBy,
  identifierMap,
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

export const SHALA_DARPAN_STUDENT_HEADERS = [
  'S.No.',
  'Shala Darpan Student ID',
  'Admission Number',
  'Admission Date',
  'Student Name',
  "Father's Name",
  "Mother's Name",
  'Date of Birth',
  'Gender',
  'Class',
  'Section',
  'Roll Number',
  'Social Category',
  'Caste',
  'Minority Group',
  'BPL',
  'CWSN',
  'CWSN Type',
  'RTE Admitted',
  'Jan Aadhaar ID',
  'PEN',
  'Academic Status',
];

export const SHALA_DARPAN_STAFF_HEADERS = [
  'S.No.',
  'Shala Darpan Staff ID',
  'Employee ID',
  'Staff Name',
  'Gender',
  'Date of Birth',
  'Designation',
  'Subject Specialisation',
  'Nature of Appointment',
  'Date of Joining',
  'Social Category',
  'Highest Academic Qualification',
  'Professional Qualification',
  'Person with Disability',
];

const INSTITUTE_HEADERS = ['Field', 'Value'];

const ORIGIN = 'workflow:compliance-export-shala-darpan';

const PERSON_IDENTIFIERS: Parameters<typeof personIdentifiers>[1] = [
  UserIdentifierType.SHALA_DARPAN_ID,
  UserIdentifierType.PEN,
  UserIdentifierType.JAN_AADHAAR,
];

export interface ShalaDarpanData {
  instituteName: Record<string, string> | null;
  instituteIdentifiers: ReadonlyArray<{ type: InstituteIdentifierType; value: string }>;
  yearLabel: string;
  students: readonly StudentYearRow[];
  guardians: readonly GuardianNameRow[];
  staff: readonly StaffYearRow[];
  qualifications: readonly StaffQualificationRow[];
  identifiers: readonly PersonIdentifierRow[];
}

export async function generateShalaDarpanExport(
  db: DrizzleDB,
  tenantId: string,
  academicYearId: string,
): Promise<ComplianceExportOutput> {
  const data = await withTenant(
    db,
    mkInstituteCtx(tenantId, ORIGIN),
    async (tx): Promise<ShalaDarpanData> => {
      const year = await academicYearOf(tx, academicYearId);
      const [institute] = await tx
        .select({ name: institutesLive.name })
        .from(institutesLive)
        .where(eq(institutesLive.id, tenantId));
      const instituteIdentifiers = await tx
        .select({ type: instituteIdentifiersLive.type, value: instituteIdentifiersLive.value })
        .from(instituteIdentifiersLive)
        .where(
          inArray(instituteIdentifiersLive.type, [
            InstituteIdentifierType.SHALA_DARPAN_ID,
            InstituteIdentifierType.UDISE_PLUS,
          ]),
        );
      return {
        instituteName: institute?.name ?? null,
        instituteIdentifiers,
        yearLabel: year.label,
        students: await studentsInYear(tx, academicYearId),
        guardians: await guardianNames(tx),
        staff: await staffEmployedDuring(tx, year),
        qualifications: await staffQualifications(tx),
        identifiers: await personIdentifiers(tx, PERSON_IDENTIFIERS),
      };
    },
  );
  return buildShalaDarpanExport(data);
}

export function buildShalaDarpanExport(data: ShalaDarpanData): ComplianceExportOutput {
  const guardianMap = groupBy(data.guardians, (g) => g.studentProfileId);
  const qualMap = groupBy(data.qualifications, (q) => q.staffProfileId);
  const shalaDarpanIds = identifierMap(data.identifiers, UserIdentifierType.SHALA_DARPAN_ID);
  const pens = identifierMap(data.identifiers, UserIdentifierType.PEN);
  const janAadhaarIds = identifierMap(data.identifiers, UserIdentifierType.JAN_AADHAAR);

  const studentRows = data.students.map((student, index) => {
    const { father, mother } = parentsOf(guardianMap.get(student.id) ?? []);
    return {
      'S.No.': index + 1,
      'Shala Darpan Student ID': shalaDarpanIds.get(student.userId) ?? '',
      'Admission Number': student.admissionNumber,
      'Admission Date': formatDateDmy(student.admissionDate),
      'Student Name': fullName(student),
      "Father's Name": father ? fullName(father) : '',
      "Mother's Name": mother ? fullName(mother) : '',
      'Date of Birth': formatDateDmy(student.dateOfBirth),
      Gender: genderLabel(student.gender),
      Class: resolveI18n(student.standardName),
      Section: resolveI18n(student.sectionName),
      'Roll Number': student.rollNumber ?? '',
      'Social Category': socialCategoryLabel(student.socialCategory),
      Caste: student.caste ?? '',
      'Minority Group': student.minorityType ?? '',
      BPL: yesNo(student.isBpl),
      CWSN: yesNo(student.isCwsn),
      'CWSN Type': student.cwsnType ?? '',
      'RTE Admitted': yesNo(student.isRteAdmitted),
      'Jan Aadhaar ID': janAadhaarIds.get(student.userId) ?? '',
      PEN: pens.get(student.userId) ?? '',
      'Academic Status': student.academicStatus,
    };
  });

  const staffRows = data.staff.map((staff, index) => {
    const quals = qualMap.get(staff.id) ?? [];
    return {
      'S.No.': index + 1,
      'Shala Darpan Staff ID': shalaDarpanIds.get(staff.userId) ?? '',
      'Employee ID': staff.employeeId ?? '',
      'Staff Name': fullName(staff),
      Gender: genderLabel(staff.gender),
      'Date of Birth': formatDateDmy(staff.dateOfBirth),
      Designation: staff.designation ?? '',
      'Subject Specialisation': staff.specialization ?? '',
      'Nature of Appointment': natureOfAppointment(staff),
      'Date of Joining': formatDateDmy(staff.dateOfJoining),
      'Social Category': socialCategoryLabel(staff.socialCategory),
      'Highest Academic Qualification':
        latestQualification(quals, QualificationType.ACADEMIC)?.degreeName ?? '',
      'Professional Qualification':
        latestQualification(quals, QualificationType.PROFESSIONAL)?.degreeName ?? '',
      'Person with Disability': yesNo(staff.isDisabled),
    };
  });

  const instituteId = (type: InstituteIdentifierType) =>
    data.instituteIdentifiers.find((id) => id.type === type)?.value ?? '';
  const instituteRows = [
    { Field: 'Institute Name', Value: resolveI18n(data.instituteName) },
    {
      Field: 'Shala Darpan Institute ID',
      Value: instituteId(InstituteIdentifierType.SHALA_DARPAN_ID),
    },
    { Field: 'UDISE+ Code', Value: instituteId(InstituteIdentifierType.UDISE_PLUS) },
    { Field: 'Academic Year', Value: data.yearLabel },
    { Field: 'Student Count', Value: studentRows.length },
    { Field: 'Staff Count', Value: staffRows.length },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(studentRows, { header: SHALA_DARPAN_STUDENT_HEADERS }),
    'Students',
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(staffRows, { header: SHALA_DARPAN_STAFF_HEADERS }),
    'Staff',
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(instituteRows, { header: INSTITUTE_HEADERS }),
    'Institute',
  );

  return {
    buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    rowCount: studentRows.length + staffRows.length,
  };
}
