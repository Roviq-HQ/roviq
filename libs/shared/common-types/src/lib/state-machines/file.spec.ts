import { describe, expect, it } from 'vitest';
import { FILE_STATUS_VALUES, type FileStatus } from '../enums/file';
import { ErrorCode } from '../error-codes';
import { FILE_STATE_MACHINE } from './file';

describe('FILE_STATE_MACHINE', () => {
  it('should declare an entry for every FileStatus value', () => {
    expect(Object.keys(FILE_STATE_MACHINE.transitions).sort()).toEqual(
      [...FILE_STATUS_VALUES].sort(),
    );
  });

  it.each([
    ['PENDING', 'READY'],
    ['PENDING', 'REJECTED'],
    ['PENDING', 'QUARANTINED'],
    ['READY', 'DELETED'],
  ] as Array<[FileStatus, FileStatus]>)('should allow %s → %s', (from, to) => {
    expect(FILE_STATE_MACHINE.canTransition(from, to)).toBe(true);
  });

  it.each([
    ['READY', 'PENDING'],
    ['REJECTED', 'READY'],
    ['DELETED', 'READY'],
    ['PENDING', 'DELETED'],
    ['QUARANTINED', 'READY'],
    ['READY', 'QUARANTINED'],
  ] as Array<[FileStatus, FileStatus]>)('should refuse %s → %s', (from, to) => {
    expect(FILE_STATE_MACHINE.canTransition(from, to)).toBe(false);
  });

  it('should throw INVALID_STATE_TRANSITION when a rejected file is made ready', () => {
    expect(() => FILE_STATE_MACHINE.assertTransition('REJECTED', 'READY')).toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_STATE_TRANSITION }),
    );
  });
});
