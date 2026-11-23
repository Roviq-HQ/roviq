import { describe, expect, it } from 'vitest';
import { BusinessException } from '../business-exception';
import type { MessagingSenderStatus } from '../enums/notification';
import { MESSAGING_SENDER_STATE_MACHINE } from './messaging-sender';

describe('MESSAGING_SENDER_STATE_MACHINE', () => {
  it.each<[MessagingSenderStatus, MessagingSenderStatus]>([
    ['ACTIVE', 'PAUSED'],
    ['ACTIVE', 'BLOCKED'],
    ['PAUSED', 'ACTIVE'],
    ['PAUSED', 'BLOCKED'],
    ['BLOCKED', 'ACTIVE'],
  ])('should allow %s → %s', (from, to) => {
    expect(MESSAGING_SENDER_STATE_MACHINE.canTransition(from, to)).toBe(true);
  });

  it.each<[MessagingSenderStatus, MessagingSenderStatus]>([
    ['BLOCKED', 'PAUSED'],
    ['ACTIVE', 'ACTIVE'],
    ['PAUSED', 'PAUSED'],
    ['BLOCKED', 'BLOCKED'],
  ])('should refuse %s → %s', (from, to) => {
    expect(MESSAGING_SENDER_STATE_MACHINE.canTransition(from, to)).toBe(false);
    expect(() => MESSAGING_SENDER_STATE_MACHINE.assertTransition(from, to)).toThrow(
      BusinessException,
    );
  });
});
