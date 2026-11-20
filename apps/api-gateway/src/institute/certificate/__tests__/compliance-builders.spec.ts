import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { AWR_HEADERS, type AwrRow, buildAwr } from '../exports/awr.export';
import type { CbseCandidateData } from '../exports/cbse-candidates';
import { buildCbseLoc, LOC_HEADERS } from '../exports/cbse-loc.export';
import { buildCbseRegistration } from '../exports/cbse-registration.export';
import { buildRteReport, RTE_HEADERS } from '../exports/rte-report.export';
import type { StaffYearRow } from '../exports/staff-for-year';
import type { StudentYearRow } from '../exports/students-for-year';
import {
  buildTcRegister,
  TC_REGISTER_HEADERS,
  type TcRegisterRow,
} from '../exports/tc-register.export';
import type { ComplianceExportOutput } from '../exports/types';
import { buildUdiseDcf } from '../exports/udise-dcf.export';

function rowsOf(output: ComplianceExportOutput, sheet: string): Record<string, unknown>[] {
  const ws = XLSX.read(output.buffer).Sheets[sheet];
  if (!ws) throw new Error(`Sheet ${sheet} missing`);
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
}

function headerRow(output: ComplianceExportOutput, sheet: string): unknown[] {
  const ws = XLSX.read(output.buffer).Sheets[sheet];
  if (!ws) throw new Error(`Sheet ${sheet} missing`);
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 })[0] ?? [];
}

function student(overrides: Partial<StudentYearRow> = {}): StudentYearRow {
  return {
    id: 'student-1',
    userId: 'user-1',
    admissionNumber: 'ADM-0001',
    admissionDate: '2025-05-10',
    admissionClass: 'Class 9',
    admissionType: 'NEW',
    academicStatus: 'ENROLLED',
    socialCategory: 'OBC',
    caste: null,
    minorityType: null,
    isBpl: false,
    isCwsn: false,
    cwsnType: null,
    isRteAdmitted: true,
    stream: null,
    firstName: { en: 'Anita' },
    lastName: { en: 'Yadav' },
    gender: 'FEMALE',
    dateOfBirth: '2011-02-03',
    motherTongue: 'Hindi',
    rollNumber: '7',
    standardId: 'std-9',
    standardName: { en: 'Class 9' },
    udiseClassCode: 9,
    sectionName: { en: 'B' },
    mediumOfInstruction: 'hindi',
    ...overrides,
  };
}

function teacher(overrides: Partial<StaffYearRow> = {}): StaffYearRow {
  return {
    id: 'staff-1',
    userId: 'user-t1',
    employeeId: 'EMP-1',
    designation: 'TGT Maths',
    department: null,
    specialization: null,
    natureOfAppointment: null,
    employmentType: 'REGULAR',
    dateOfJoining: '2020-06-01',
    dateOfLeaving: null,
    socialCategory: 'GENERAL',
    trainedForCwsn: false,
    isDisabled: false,
    disabilityType: null,
    firstName: { en: 'Ravi' },
    lastName: { en: 'Kumar' },
    gender: 'MALE',
    dateOfBirth: '1984-07-09',
    ...overrides,
  };
}

const IDENTIFIERS = [
  { userId: 'user-1', type: 'APAAR' as const, valuePlain: '123456789012', valueMasked: null },
  { userId: 'user-1', type: 'PEN' as const, valuePlain: null, valueMasked: 'XXXXXXX4321' },
  {
    userId: 'user-10',
    type: 'CBSE_REGISTRATION' as const,
    valuePlain: 'A119/03001/0057',
    valueMasked: null,
  },
];

describe('buildUdiseDcf', () => {
  it('should write names, not ids, in DCF formats, with APAAR and PEN as stored', () => {
    const output = buildUdiseDcf({
      students: [student()],
      guardians: [
        {
          studentProfileId: 'student-1',
          relationship: 'MOTHER',
          userId: 'user-m',
          firstName: { en: 'Sunita' },
          lastName: { en: 'Yadav' },
        },
      ],
      identifiers: IDENTIFIERS,
      staff: [teacher()],
      qualifications: [],
    });

    expect(rowsOf(output, 'Students')).toEqual([
      {
        'Student Name': 'ANITA YADAV',
        "Father's Name": '',
        "Mother's Name": 'Sunita Yadav',
        'Date of Birth': '03/02/2011',
        Gender: 'Female',
        'Aadhaar Number': '',
        'Mother Tongue': 'Hindi',
        'Social Category': 'OBC',
        'Minority Status': 'Not Applicable',
        'Is BPL': 'No',
        'Is CWSN': 'No',
        'CWSN Type': '',
        'RTE Admitted': 'Yes',
        Class: 'Class 9',
        Section: 'B',
        'Admission Number': 'ADM-0001',
        Stream: '',
        'Medium of Instruction': 'hindi',
        'Previous Year Status': '',
        'APAAR ID': '123456789012',
        PEN: 'XXXXXXX4321',
      },
    ]);
    expect(rowsOf(output, 'Teachers')[0]).toMatchObject({
      'Teacher Name': 'RAVI KUMAR',
      'Date of Birth': '09/07/1984',
      Gender: 'Male',
      'Social Category': 'General',
      'Nature of Appointment': 'Regular',
      'Date of Joining': '01/06/2020',
    });
    expect(output.rowCount).toBe(2);
  });
});

describe('CBSE builders', () => {
  const data: CbseCandidateData = {
    students: [
      student(),
      student({ id: 'student-11', userId: 'user-11', udiseClassCode: 11 }),
      student({
        id: 'student-10',
        userId: 'user-10',
        udiseClassCode: 10,
        firstName: { en: 'Kabir' },
      }),
      student({ id: 'student-x', userId: 'user-x', udiseClassCode: null }),
    ],
    guardians: [
      {
        studentProfileId: 'student-1',
        relationship: 'FATHER',
        userId: 'user-f',
        firstName: { en: 'Mahesh' },
        lastName: { en: 'Yadav' },
      },
    ],
    identifiers: IDENTIFIERS,
    phones: new Map([['user-f', '9876543210']]),
  };

  it('should split registration into Class IX and Class XI sheets only', () => {
    const output = buildCbseRegistration(data);

    expect(XLSX.read(output.buffer).SheetNames).toEqual(['Class IX', 'Class XI']);
    expect(rowsOf(output, 'Class IX')).toEqual([
      expect.objectContaining({
        'Student Name (CAPITALS)': 'ANITA YADAV',
        "Father's/Guardian's Name": 'Mahesh Yadav',
        'Date of Birth': '03/02/2011',
        Gender: 'Female',
        'APAAR ID': '123456789012',
        'Mobile Number': '9876543210',
      }),
    ]);
    expect(rowsOf(output, 'Class XI')).toHaveLength(1);
    expect(output.rowCount).toBe(2);
  });

  it('should put only Class X and XII in the LOC, with the CBSE registration number', () => {
    const output = buildCbseLoc(data);

    expect(XLSX.read(output.buffer).SheetNames).toEqual(['Class X', 'Class XII']);
    expect(headerRow(output, 'Class X')).toEqual(LOC_HEADERS);
    expect(rowsOf(output, 'Class X')).toEqual([
      {
        'Registration Number': 'A119/03001/0057',
        'Student Name (CAPITALS)': 'KABIR YADAV',
        'Date of Birth': '03/02/2011',
        Gender: 'Female',
        'APAAR ID': '',
        'Subject Code 1': '',
        'Subject Code 2': '',
        'Subject Code 3': '',
        'Subject Code 4': '',
        'Subject Code 5': '',
        'Subject Code 6': '',
        'CWSN Status': '',
      },
    ]);
    expect(rowsOf(output, 'Class XII')).toEqual([]);
    expect(output.rowCount).toBe(1);
  });
});

describe('buildRteReport', () => {
  it('should count students per class by class name, in class order', () => {
    const output = buildRteReport([
      { standardId: 's5', standardName: { en: 'Class 5' }, isRteAdmitted: true },
      { standardId: 's5', standardName: { en: 'Class 5' }, isRteAdmitted: false },
      { standardId: 's9', standardName: { en: 'Class 9' }, isRteAdmitted: false },
    ]);

    expect(headerRow(output, 'RTE Report')).toEqual(RTE_HEADERS);
    expect(rowsOf(output, 'RTE Report')).toEqual([
      { Class: 'Class 5', 'RTE Students Count': 1, 'Total Students': 2 },
      { Class: 'Class 9', 'RTE Students Count': 0, 'Total Students': 1 },
    ]);
    expect(output.rowCount).toBe(2);
  });
});

describe('buildTcRegister', () => {
  it('should name the student and write IST calendar dates as DD/MM/YYYY', () => {
    const tc: TcRegisterRow = {
      tcSerialNumber: 'TC/2025-26/0001',
      status: 'ISSUED',
      reason: 'Relocation',
      requestedAt: new Date('2025-11-03T05:00:00Z'),
      issuedAt: new Date('2025-11-05T20:00:00Z'),
      isDuplicate: false,
      admissionNumber: 'ADM-0001',
      firstName: { en: 'Anita' },
      lastName: { en: 'Yadav' },
    };

    const output = buildTcRegister([tc]);

    expect(headerRow(output, 'TC Register')).toEqual(TC_REGISTER_HEADERS);
    expect(rowsOf(output, 'TC Register')).toEqual([
      {
        'TC Serial Number': 'TC/2025-26/0001',
        'Student Name': 'Anita Yadav',
        Status: 'ISSUED',
        Reason: 'Relocation',
        'Requested At': '03/11/2025',
        'Issued At': '06/11/2025',
        'Is Duplicate': 'No',
        'Admission Number': 'ADM-0001',
      },
    ]);
  });
});

describe('buildAwr', () => {
  it('should write class and section names and DD/MM/YYYY dates', () => {
    const row: AwrRow = {
      admissionNumber: 'ADM-0001',
      admissionDate: '2025-05-10',
      admissionClass: 'Class 9',
      admissionType: 'NEW',
      academicStatus: 'ENROLLED',
      socialCategory: 'GENERAL',
      firstName: { en: 'Anita' },
      lastName: { en: 'Yadav' },
      gender: 'FEMALE',
      dateOfBirth: '2011-02-03',
      standardName: { en: 'Class 9' },
      sectionName: { en: 'B' },
    };

    const output = buildAwr([row]);

    expect(headerRow(output, 'Admission Register')).toEqual(AWR_HEADERS);
    expect(rowsOf(output, 'Admission Register')).toEqual([
      {
        'S.No.': 1,
        'Admission Number': 'ADM-0001',
        'Student Name': 'Anita Yadav',
        'Date of Birth': '03/02/2011',
        Gender: 'Female',
        'Admission Date': '10/05/2025',
        'Admission Class': 'Class 9',
        'Admission Type': 'NEW',
        'Academic Status': 'ENROLLED',
        'Social Category': 'General',
        Class: 'Class 9',
        Section: 'B',
      },
    ]);
    expect(output.rowCount).toBe(1);
  });
});
