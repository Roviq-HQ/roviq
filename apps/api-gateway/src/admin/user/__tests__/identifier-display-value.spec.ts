import { describe, expect, it } from 'vitest';
import { identifierDisplayValue } from '../repositories/admin-user.drizzle-repository';

describe('identifierDisplayValue', () => {
  it('should reduce Aadhaar to its last four digits whatever the stored mask format', () => {
    expect(identifierDisplayValue('AADHAAR', 'XXXX-XXXX-4321', null)).toBe('XXXX XXXX 4321');
    expect(identifierDisplayValue('AADHAAR', '********4321', null)).toBe('XXXX XXXX 4321');
  });

  it('should hide Aadhaar when the stored mask has fewer than four digits', () => {
    expect(identifierDisplayValue('AADHAAR', 'XXXX', null)).toBeNull();
    expect(identifierDisplayValue('AADHAAR', null, null)).toBeNull();
  });

  it('should never return a plain value for an encrypted type', () => {
    expect(identifierDisplayValue('PAN', 'ABXXXXX34F', 'ABCDE1234F')).toBe('ABXXXXX34F');
    expect(identifierDisplayValue('PAN', null, 'ABCDE1234F')).toBeNull();
  });

  it('should show the plain value of a non-sensitive identifier', () => {
    expect(identifierDisplayValue('APAAR', null, '123456789012')).toBe('123456789012');
  });
});
