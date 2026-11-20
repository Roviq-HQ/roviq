import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  BSEH_STAFF_HEADERS,
  type BsehStaffStatementData,
  buildBsehStaffStatement,
} from '../exports/bseh-staff-statement.export';
import type { StaffYearRow } from '../exports/staff-for-year';

function staffRow(overrides: Partial<StaffYearRow> = {}): StaffYearRow {
  return {
    id: 'staff-1',
    userId: 'user-1',
    employeeId: 'EMP-001',
    designation: 'PGT Physics',
    department: 'Science',
    specialization: 'Physics',
    natureOfAppointment: null,
    employmentType: 'REGULAR',
    dateOfJoining: '2019-07-01',
    dateOfLeaving: null,
    socialCategory: 'OBC',
    trainedForCwsn: true,
    isDisabled: false,
    disabilityType: null,
    firstName: { en: 'Rajesh', hi: 'राजेश' },
    lastName: { en: 'Sharma' },
    gender: 'MALE',
    dateOfBirth: '1985-03-09',
    ...overrides,
  };
}

function data(overrides: Partial<BsehStaffStatementData> = {}): BsehStaffStatementData {
  return {
    instituteName: { en: 'Sunrise Public Institute' },
    affiliationNumber: 'BSEH-12345',
    yearLabel: '2025-26',
    staff: [staffRow()],
    qualifications: [
      { staffProfileId: 'staff-1', type: 'ACADEMIC', degreeName: 'B.Sc', yearOfPassing: 2006 },
      { staffProfileId: 'staff-1', type: 'ACADEMIC', degreeName: 'M.Sc', yearOfPassing: 2008 },
      { staffProfileId: 'staff-1', type: 'PROFESSIONAL', degreeName: 'B.Ed', yearOfPassing: 2009 },
    ],
    ...overrides,
  };
}

function sheetRows(buffer: Buffer, sheet: string): Record<string, unknown>[] {
  const book = XLSX.read(buffer);
  const ws = book.Sheets[sheet];
  if (!ws) throw new Error(`Sheet ${sheet} missing`);
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
}

function headerRow(buffer: Buffer, sheet: string): unknown[] {
  const ws = XLSX.read(buffer).Sheets[sheet];
  if (!ws) throw new Error(`Sheet ${sheet} missing`);
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 })[0] ?? [];
}

describe('buildBsehStaffStatement', () => {
  it('should write the staff sheet with every labelled column in order', () => {
    const { buffer } = buildBsehStaffStatement(data());

    expect(headerRow(buffer, 'Staff Statement')).toEqual(BSEH_STAFF_HEADERS);
  });

  it('should fill one row per staff member from the profile, staff record and qualifications', () => {
    const { buffer } = buildBsehStaffStatement(data());

    expect(sheetRows(buffer, 'Staff Statement')).toEqual([
      {
        'S.No.': 1,
        'Employee ID': 'EMP-001',
        'Staff Name': 'Rajesh Sharma',
        Gender: 'Male',
        'Date of Birth': '09/03/1985',
        Designation: 'PGT Physics',
        Department: 'Science',
        'Subject Specialisation': 'Physics',
        'Nature of Appointment': 'Regular',
        'Employment Type': 'Regular',
        'Date of Joining': '01/07/2019',
        'Date of Leaving': '',
        'Social Category': 'OBC',
        'Highest Academic Qualification': 'M.Sc',
        'Academic Qualification Year': 2008,
        'Professional Qualification': 'B.Ed',
        'Trained for CWSN': 'Yes',
        'Person with Disability': 'No',
        'Disability Type': '',
      },
    ]);
  });

  it('should return the number of staff rows as the row count', () => {
    const result = buildBsehStaffStatement(
      data({ staff: [staffRow(), staffRow({ id: 'staff-2', employeeId: 'EMP-002' })] }),
    );

    expect(result.rowCount).toBe(2);
  });

  it('should write the institute sheet with the BSEH affiliation number and year', () => {
    const { buffer } = buildBsehStaffStatement(data());

    expect(sheetRows(buffer, 'Institute')).toEqual([
      { Field: 'Institute Name', Value: 'Sunrise Public Institute' },
      { Field: 'BSEH Affiliation Number', Value: 'BSEH-12345' },
      { Field: 'Academic Year', Value: '2025-26' },
      { Field: 'Staff Count', Value: 1 },
    ]);
  });

  it('should produce a valid workbook with headers and a zero count when there is no staff', () => {
    const result = buildBsehStaffStatement(data({ staff: [], qualifications: [] }));

    expect(result.rowCount).toBe(0);
    expect(headerRow(result.buffer, 'Staff Statement')).toEqual(BSEH_STAFF_HEADERS);
    expect(sheetRows(result.buffer, 'Staff Statement')).toEqual([]);
  });

  it('should prefer a recorded nature of appointment over the employment type', () => {
    const { buffer } = buildBsehStaffStatement(
      data({ staff: [staffRow({ natureOfAppointment: 'Ad hoc', employmentType: 'CONTRACTUAL' })] }),
    );

    const [row] = sheetRows(buffer, 'Staff Statement');
    expect(row?.['Nature of Appointment']).toBe('Ad hoc');
    expect(row?.['Employment Type']).toBe('Contractual');
  });

  it('should leave name cells empty when the staff member has no profile', () => {
    const { buffer } = buildBsehStaffStatement(
      data({ staff: [staffRow({ firstName: null, lastName: null, gender: null })] }),
    );

    const [row] = sheetRows(buffer, 'Staff Statement');
    expect(row?.['Staff Name']).toBe('');
    expect(row?.Gender).toBe('');
  });
});
