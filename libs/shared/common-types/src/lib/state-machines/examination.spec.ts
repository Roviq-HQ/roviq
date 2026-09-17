import { describe, expect, it } from 'vitest';
import { BusinessException } from '../business-exception';
import { EXAM_STATUS_VALUES, type ExamStatus } from '../enums/examination';
import { ErrorCode } from '../error-codes';
import { EXAM_STATE_MACHINE } from './examination';

describe('EXAM_STATE_MACHINE', () => {
  it('declares an entry for every ExamStatus value', () => {
    const keys = Object.keys(EXAM_STATE_MACHINE.transitions);
    expect(keys.sort()).toEqual([...EXAM_STATUS_VALUES].sort());
  });

  it('every transition target is itself a valid ExamStatus', () => {
    for (const targets of Object.values(EXAM_STATE_MACHINE.transitions)) {
      for (const target of targets as readonly ExamStatus[]) {
        expect(EXAM_STATUS_VALUES).toContain(target);
      }
    }
  });

  it.each([
    ['DRAFT', 'SCHEDULED'],
    ['SCHEDULED', 'MARKS_ENTRY'],
    ['MARKS_ENTRY', 'LOCKED'],
    ['LOCKED', 'MARKS_ENTRY'],
    ['LOCKED', 'RESULTS_PUBLISHED'],
    ['RESULTS_PUBLISHED', 'ARCHIVED'],
  ] as Array<[ExamStatus, ExamStatus]>)('%s → %s is allowed', (from, to) => {
    expect(EXAM_STATE_MACHINE.canTransition(from, to)).toBe(true);
  });

  // Unarchive: ARCHIVED is no longer terminal — admins reverse it back to the published state.
  it('ARCHIVED → RESULTS_PUBLISHED is allowed (unarchive)', () => {
    expect(EXAM_STATE_MACHINE.canTransition('ARCHIVED', 'RESULTS_PUBLISHED')).toBe(true);
  });

  it.each([
    ['DRAFT', 'MARKS_ENTRY'],
    ['SCHEDULED', 'RESULTS_PUBLISHED'],
    ['ARCHIVED', 'DRAFT'],
    ['ARCHIVED', 'ARCHIVED'],
  ] as Array<[ExamStatus, ExamStatus]>)('%s → %s is rejected', (from, to) => {
    expect(EXAM_STATE_MACHINE.canTransition(from, to)).toBe(false);
  });

  it('assertTransition throws BusinessException on illegal transition', () => {
    let caught: unknown;
    try {
      EXAM_STATE_MACHINE.assertTransition('ARCHIVED', 'DRAFT');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BusinessException);
    expect((caught as BusinessException).code).toBe(ErrorCode.INVALID_STATE_TRANSITION);
  });
});
