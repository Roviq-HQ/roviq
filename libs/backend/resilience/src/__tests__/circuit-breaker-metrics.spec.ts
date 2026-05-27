import { describe, expect, it } from 'vitest';
import { circuitBreakerStateValue } from '../circuit-breaker-metrics';

describe('circuitBreakerStateValue', () => {
  it('maps open=2, half-open=1, closed=0', () => {
    expect(circuitBreakerStateValue({ opened: true, halfOpen: false })).toBe(2);
    expect(circuitBreakerStateValue({ opened: false, halfOpen: true })).toBe(1);
    expect(circuitBreakerStateValue({ opened: false, halfOpen: false })).toBe(0);
  });
});
