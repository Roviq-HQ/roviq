import { describe, expect, it } from 'vitest';
import { DLQ_STATE_MACHINE } from './dlq-status';

describe('DLQ_STATE_MACHINE', () => {
  it('allows pending → replayed', () => {
    expect(() => DLQ_STATE_MACHINE.assertTransition('pending', 'replayed')).not.toThrow();
  });
  it('allows pending → discarded', () => {
    expect(() => DLQ_STATE_MACHINE.assertTransition('pending', 'discarded')).not.toThrow();
  });
  it('allows replayed → replayed (re-replay)', () => {
    expect(() => DLQ_STATE_MACHINE.assertTransition('replayed', 'replayed')).not.toThrow();
  });
  it('rejects discarded → replayed', () => {
    expect(() => DLQ_STATE_MACHINE.assertTransition('discarded', 'replayed')).toThrow();
  });
});
