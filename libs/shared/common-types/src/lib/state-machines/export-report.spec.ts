import { describe, expect, it } from 'vitest';
import { EXPORT_REPORT_STATUS_VALUES, type ExportReportStatus } from '../enums/compliance-export';
import { ErrorCode } from '../error-codes';
import { EXPORT_REPORT_STATE_MACHINE } from './export-report';

describe('EXPORT_REPORT_STATE_MACHINE', () => {
  it('should declare an entry for every ExportReportStatus value', () => {
    expect(Object.keys(EXPORT_REPORT_STATE_MACHINE.transitions).sort()).toEqual(
      [...EXPORT_REPORT_STATUS_VALUES].sort(),
    );
  });

  it.each([
    ['PENDING', 'RUNNING'],
    ['PENDING', 'FAILED'],
    ['RUNNING', 'COMPLETED'],
    ['RUNNING', 'FAILED'],
  ] as Array<[ExportReportStatus, ExportReportStatus]>)('should allow %s → %s', (from, to) => {
    expect(EXPORT_REPORT_STATE_MACHINE.canTransition(from, to)).toBe(true);
  });

  it.each([
    ['PENDING', 'COMPLETED'],
    ['RUNNING', 'PENDING'],
    ['COMPLETED', 'FAILED'],
    ['COMPLETED', 'RUNNING'],
    ['FAILED', 'RUNNING'],
    ['FAILED', 'COMPLETED'],
  ] as Array<[ExportReportStatus, ExportReportStatus]>)('should refuse %s → %s', (from, to) => {
    expect(EXPORT_REPORT_STATE_MACHINE.canTransition(from, to)).toBe(false);
  });

  it('should treat COMPLETED and FAILED as terminal', () => {
    expect(EXPORT_REPORT_STATE_MACHINE.transitions.COMPLETED).toEqual([]);
    expect(EXPORT_REPORT_STATE_MACHINE.transitions.FAILED).toEqual([]);
  });

  it('should throw INVALID_STATE_TRANSITION when a failed export is completed', () => {
    expect(() => EXPORT_REPORT_STATE_MACHINE.assertTransition('FAILED', 'COMPLETED')).toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_STATE_TRANSITION }),
    );
  });
});
