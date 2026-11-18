import { describe, expect, it, vi } from 'vitest';
import { refetchUnlessUnmounted } from '../use-guardians';

describe('refetchUnlessUnmounted', () => {
  it('should resolve when the refetch was aborted because its component unmounted', async () => {
    const refetch = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));

    await expect(refetchUnlessUnmounted({ refetch })).resolves.toBeUndefined();
  });

  it('should still reject on a real refetch failure', async () => {
    const failure = new Error('network down');
    const refetch = vi.fn().mockRejectedValue(failure);

    await expect(refetchUnlessUnmounted({ refetch })).rejects.toBe(failure);
  });
});
