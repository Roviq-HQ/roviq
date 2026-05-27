import { describe, expect, it } from 'vitest';
import { BusinessException } from '../business-exception';
import { ErrorCode } from '../error-codes';
import { TIMETABLE_STATE_MACHINE } from './timetable';

describe('TIMETABLE_STATE_MACHINE', () => {
  it('allows publish/retire/re-activate/archive transitions', () => {
    expect(TIMETABLE_STATE_MACHINE.canTransition('DRAFT', 'ACTIVE')).toBe(true);
    expect(TIMETABLE_STATE_MACHINE.canTransition('DRAFT', 'ARCHIVED')).toBe(true);
    expect(TIMETABLE_STATE_MACHINE.canTransition('ACTIVE', 'INACTIVE')).toBe(true);
    expect(TIMETABLE_STATE_MACHINE.canTransition('ACTIVE', 'ARCHIVED')).toBe(true);
    expect(TIMETABLE_STATE_MACHINE.canTransition('INACTIVE', 'ACTIVE')).toBe(true);
    expect(TIMETABLE_STATE_MACHINE.canTransition('INACTIVE', 'ARCHIVED')).toBe(true);
  });

  it('rejects illegal transitions', () => {
    expect(TIMETABLE_STATE_MACHINE.canTransition('ARCHIVED', 'ACTIVE')).toBe(false);
    expect(TIMETABLE_STATE_MACHINE.canTransition('DRAFT', 'INACTIVE')).toBe(false);
    expect(TIMETABLE_STATE_MACHINE.canTransition('ACTIVE', 'DRAFT')).toBe(false);
  });

  it('assertTransition throws INVALID_STATE_TRANSITION on illegal move', () => {
    let caught: unknown;
    try {
      TIMETABLE_STATE_MACHINE.assertTransition('ARCHIVED', 'ACTIVE');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BusinessException);
    expect((caught as BusinessException).code).toBe(ErrorCode.INVALID_STATE_TRANSITION);
  });
});
