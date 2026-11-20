import { describe, expect, it } from 'vitest';
import { eligibleComplianceReportTypes } from './export-eligibility';

const NONE = { boards: [], state: null, identifierTypes: [] };

describe('eligibleComplianceReportTypes', () => {
  it('should offer only the national exports to an institute with no board or state match', () => {
    expect(eligibleComplianceReportTypes(NONE)).toEqual([
      'UDISE_DCF',
      'RTE_REPORT',
      'TC_REGISTER',
      'AWR',
    ]);
  });

  it('should add both CBSE exports for a CBSE-affiliated institute', () => {
    expect(eligibleComplianceReportTypes({ ...NONE, boards: ['CBSE'], state: 'Delhi' })).toEqual([
      'UDISE_DCF',
      'CBSE_REGISTRATION',
      'CBSE_LOC',
      'RTE_REPORT',
      'TC_REGISTER',
      'AWR',
    ]);
  });

  it('should add only the BSEH staff statement for a BSEH-only institute', () => {
    expect(eligibleComplianceReportTypes({ ...NONE, boards: ['BSEH'], state: 'Haryana' })).toEqual([
      'UDISE_DCF',
      'BSEH_STAFF_STATEMENT',
      'RTE_REPORT',
      'TC_REGISTER',
      'AWR',
    ]);
  });

  it('should not offer BSEH or Shala Darpan to a CBSE institute in Haryana', () => {
    const types = eligibleComplianceReportTypes({ ...NONE, boards: ['CBSE'], state: 'Haryana' });

    expect(types).not.toContain('BSEH_STAFF_STATEMENT');
    expect(types).not.toContain('SHALA_DARPAN');
  });

  it.each([
    ['an RBSE affiliation', { ...NONE, boards: ['RBSE'] }],
    ['an address in Rajasthan', { ...NONE, state: ' Rajasthan ' }],
    ['a Shala Darpan ID', { ...NONE, identifierTypes: ['SHALA_DARPAN_ID'] }],
  ])('should add Shala Darpan for %s', (_reason, input) => {
    expect(eligibleComplianceReportTypes(input)).toContain('SHALA_DARPAN');
  });

  it('should match board names whatever their case', () => {
    expect(eligibleComplianceReportTypes({ ...NONE, boards: ['cbse'] })).toContain('CBSE_LOC');
  });
});
