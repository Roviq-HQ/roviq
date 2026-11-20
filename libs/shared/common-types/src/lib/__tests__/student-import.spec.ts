import { describe, expect, it } from 'vitest';
import { isStudentImportField, studentImportFieldForHeader } from '../student-import';

describe('studentImportFieldForHeader', () => {
  it('should read a header written in words as the field it names', () => {
    expect(studentImportFieldForHeader('Date of Birth')).toBe('date_of_birth');
    expect(studentImportFieldForHeader('  FIRST NAME ')).toBe('first_name');
    expect(studentImportFieldForHeader('Father Name')).toBe('father_name');
    expect(studentImportFieldForHeader("Father's Name")).toBeNull();
  });

  it('should return null for a header that names no field', () => {
    expect(studentImportFieldForHeader('DOB')).toBeNull();
    expect(studentImportFieldForHeader('जन्म तिथि')).toBeNull();
  });
});

describe('isStudentImportField', () => {
  it('should accept only the field names the import knows', () => {
    expect(isStudentImportField('blood_group')).toBe(true);
    expect(isStudentImportField('aadhaar')).toBe(false);
  });
});
