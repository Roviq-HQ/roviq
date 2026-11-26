import { describe, expect, it } from 'vitest';
import { retryDelay } from '../client';

describe('retryDelay', () => {
  it('doubles up to 30 seconds', () => {
    expect(retryDelay(0, () => 1)).toBe(1_000);
    expect(retryDelay(3, () => 1)).toBe(8_000);
    expect(retryDelay(10, () => 1)).toBe(30_000);
  });

  it('spreads attempts over the upper half of the window', () => {
    expect(retryDelay(3, () => 0)).toBe(4_000);
    expect(retryDelay(3, () => 0.5)).toBe(6_000);
    const many = new Set(Array.from({ length: 20 }, () => retryDelay(4)));
    expect(many.size).toBeGreaterThan(1);
  });
});
