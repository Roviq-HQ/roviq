import { describe, expect, it } from 'vitest';
import { complianceExportFileName } from '../export-file-name';

describe('complianceExportFileName', () => {
  it('should join the institute code, report type and year label', () => {
    expect(
      complianceExportFileName({
        instituteCode: 'RVQ-001',
        reportType: 'UDISE_DCF',
        academicYearLabel: '2025-26',
      }),
    ).toBe('RVQ-001-UDISE_DCF-2025-26.xlsx');
  });

  it('should replace slashes, spaces and other unsafe characters with single dashes', () => {
    expect(
      complianceExportFileName({
        instituteCode: ' DPS / R.K. Puram "#1" ',
        reportType: 'SHALA_DARPAN',
        academicYearLabel: '2025-26',
      }),
    ).toBe('DPS-R.K.-Puram-1-SHALA_DARPAN-2025-26.xlsx');
  });

  it('should never let a path escape the name', () => {
    const name = complianceExportFileName({
      instituteCode: '../../etc/passwd',
      reportType: 'AWR',
      academicYearLabel: '2024-25',
    });

    expect(name).not.toContain('/');
    expect(name.startsWith('.')).toBe(false);
    expect(name).toBe('etc-passwd-AWR-2024-25.xlsx');
  });

  it('should drop accents and non-Latin letters instead of writing them', () => {
    expect(
      complianceExportFileName({
        instituteCode: 'विद्यालय-É01',
        reportType: 'TC_REGISTER',
        academicYearLabel: '2025-26',
      }),
    ).toBe('E01-TC_REGISTER-2025-26.xlsx');
  });
});
