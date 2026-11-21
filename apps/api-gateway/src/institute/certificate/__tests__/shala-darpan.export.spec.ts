import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  buildShalaDarpanExport,
  SHALA_DARPAN_STAFF_HEADERS,
  SHALA_DARPAN_STUDENT_HEADERS,
  type ShalaDarpanData,
} from '../exports/shala-darpan.export';
import type { StaffYearRow } from '../exports/staff-for-year';

type StudentRow = ShalaDarpanData['students'][number];

function student(overrides: Partial<StudentRow> = {}): StudentRow {
  return {
    id: 'student-1',
    userId: 'user-student-1',
    admissionNumber: 'ADM-0001',
    admissionDate: '2024-04-02',
    admissionClass: null,
    admissionType: 'NEW',
    academicStatus: 'ENROLLED',
    socialCategory: 'SC',
    caste: 'Meghwal',
    minorityType: null,
    isBpl: true,
    isCwsn: false,
    cwsnType: null,
    isRteAdmitted: true,
    stream: null,
    firstName: { en: 'Priya' },
    lastName: { en: 'Meena' },
    gender: 'FEMALE',
    dateOfBirth: '2014-11-21',
    motherTongue: null,
    rollNumber: '12',
    standardId: 'std-5',
    standardName: { en: 'Class 5' },
    udiseClassCode: 5,
    sectionName: { en: 'A' },
    mediumOfInstruction: null,
    ...overrides,
  };
}

function staff(overrides: Partial<StaffYearRow> = {}): StaffYearRow {
  return {
    id: 'staff-1',
    userId: 'user-staff-1',
    employeeId: 'EMP-010',
    designation: 'TGT Hindi',
    department: 'Languages',
    specialization: 'Hindi',
    natureOfAppointment: null,
    employmentType: 'CONTRACTUAL',
    dateOfJoining: '2021-06-15',
    dateOfLeaving: null,
    socialCategory: 'GENERAL',
    trainedForCwsn: false,
    isDisabled: true,
    disabilityType: 'Locomotor',
    firstName: { en: 'Sunita' },
    lastName: { en: 'Verma' },
    gender: 'FEMALE',
    dateOfBirth: '1990-01-05',
    ...overrides,
  };
}

function data(overrides: Partial<ShalaDarpanData> = {}): ShalaDarpanData {
  return {
    instituteName: { en: 'Govt Senior Secondary Institute, Ajmer' },
    instituteIdentifiers: [
      { type: 'SHALA_DARPAN_ID', value: 'SD-08-0001' },
      { type: 'UDISE_PLUS', value: '08010203040' },
    ],
    yearLabel: '2025-26',
    students: [student()],
    guardians: [
      {
        studentProfileId: 'student-1',
        relationship: 'FATHER',
        userId: 'user-father',
        firstName: { en: 'Ramesh' },
        lastName: { en: 'Meena' },
      },
      {
        studentProfileId: 'student-1',
        relationship: 'MOTHER',
        userId: 'user-mother',
        firstName: { en: 'Kamla' },
        lastName: null,
      },
    ],
    staff: [staff()],
    qualifications: [
      {
        staffProfileId: 'staff-1',
        type: 'ACADEMIC',
        degreeName: 'M.A. Hindi',
        yearOfPassing: 2013,
      },
      { staffProfileId: 'staff-1', type: 'PROFESSIONAL', degreeName: 'B.Ed', yearOfPassing: 2014 },
    ],
    identifiers: [
      {
        userId: 'user-student-1',
        type: 'SHALA_DARPAN_ID',
        valuePlain: 'SDS-778899',
        valueMasked: null,
      },
      { userId: 'user-student-1', type: 'PEN', valuePlain: '20240012345', valueMasked: null },
      {
        userId: 'user-student-1',
        type: 'JAN_AADHAAR',
        valuePlain: null,
        valueMasked: 'XXXXXX4521',
      },
      {
        userId: 'user-staff-1',
        type: 'SHALA_DARPAN_ID',
        valuePlain: 'SDT-1122',
        valueMasked: null,
      },
    ],
    ...overrides,
  };
}

function sheetRows(buffer: Buffer, sheet: string): Record<string, unknown>[] {
  const ws = XLSX.read(buffer).Sheets[sheet];
  if (!ws) throw new Error(`Sheet ${sheet} missing`);
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
}

function headerRow(buffer: Buffer, sheet: string): unknown[] {
  const ws = XLSX.read(buffer).Sheets[sheet];
  if (!ws) throw new Error(`Sheet ${sheet} missing`);
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 })[0] ?? [];
}

describe('buildShalaDarpanExport', () => {
  it('should write Students, Staff and Institute sheets with labelled columns', () => {
    const { buffer } = buildShalaDarpanExport(data());

    expect(XLSX.read(buffer).SheetNames).toEqual(['Students', 'Staff', 'Institute']);
    expect(headerRow(buffer, 'Students')).toEqual(SHALA_DARPAN_STUDENT_HEADERS);
    expect(headerRow(buffer, 'Staff')).toEqual(SHALA_DARPAN_STAFF_HEADERS);
  });

  it('should fill a student row with parents, class, identifiers and welfare flags', () => {
    const { buffer } = buildShalaDarpanExport(data());

    expect(sheetRows(buffer, 'Students')).toEqual([
      {
        'S.No.': 1,
        'Shala Darpan Student ID': 'SDS-778899',
        'Admission Number': 'ADM-0001',
        'Admission Date': '02/04/2024',
        'Student Name': 'Priya Meena',
        "Father's Name": 'Ramesh Meena',
        "Mother's Name": 'Kamla',
        'Date of Birth': '21/11/2014',
        Gender: 'Female',
        Class: 'Class 5',
        Section: 'A',
        'Roll Number': '12',
        'Social Category': 'SC',
        Caste: 'Meghwal',
        'Minority Group': '',
        BPL: 'Yes',
        CWSN: 'No',
        'CWSN Type': '',
        'RTE Admitted': 'Yes',
        'Jan Aadhaar ID': 'XXXXXX4521',
        PEN: '20240012345',
        'Academic Status': 'ENROLLED',
      },
    ]);
  });

  it('should fill a staff row with the Shala Darpan staff ID and qualifications', () => {
    const { buffer } = buildShalaDarpanExport(data());

    expect(sheetRows(buffer, 'Staff')).toEqual([
      {
        'S.No.': 1,
        'Shala Darpan Staff ID': 'SDT-1122',
        'Employee ID': 'EMP-010',
        'Staff Name': 'Sunita Verma',
        Gender: 'Female',
        'Date of Birth': '05/01/1990',
        Designation: 'TGT Hindi',
        'Subject Specialisation': 'Hindi',
        'Nature of Appointment': 'Contractual',
        'Date of Joining': '15/06/2021',
        'Social Category': 'General',
        'Highest Academic Qualification': 'M.A. Hindi',
        'Professional Qualification': 'B.Ed',
        'Person with Disability': 'Yes',
      },
    ]);
  });

  it('should count students and staff together as the row count', () => {
    const result = buildShalaDarpanExport(
      data({ students: [student(), student({ id: 'student-2', userId: 'user-student-2' })] }),
    );

    expect(result.rowCount).toBe(3);
  });

  it('should write the institute Shala Darpan ID and UDISE+ code', () => {
    const { buffer } = buildShalaDarpanExport(data());

    expect(sheetRows(buffer, 'Institute')).toEqual([
      { Field: 'Institute Name', Value: 'Govt Senior Secondary Institute, Ajmer' },
      { Field: 'Shala Darpan Institute ID', Value: 'SD-08-0001' },
      { Field: 'UDISE+ Code', Value: '08010203040' },
      { Field: 'Academic Year', Value: '2025-26' },
      { Field: 'Student Count', Value: 1 },
      { Field: 'Staff Count', Value: 1 },
    ]);
  });

  it('should never write an Aadhaar number, even when one is stored for the student', () => {
    const { buffer } = buildShalaDarpanExport(
      data({
        identifiers: [
          {
            userId: 'user-student-1',
            type: 'AADHAAR',
            valuePlain: null,
            valueMasked: 'XXXX-XXXX-1234',
          },
        ],
      }),
    );

    const cells = sheetRows(buffer, 'Students').flatMap((row) => Object.values(row));
    expect(cells).not.toContain('XXXX-XXXX-1234');
  });

  it('should produce headers and a zero count for an institute with nobody in the year', () => {
    const result = buildShalaDarpanExport(
      data({ students: [], staff: [], guardians: [], qualifications: [], identifiers: [] }),
    );

    expect(result.rowCount).toBe(0);
    expect(headerRow(result.buffer, 'Students')).toEqual(SHALA_DARPAN_STUDENT_HEADERS);
  });
});
