import { describe, expect, it, vi } from 'vitest';
import { runCanary } from '../canary-logic';
import type { CanaryRequest } from '../notification-workflow.types';

const AT = '2026-11-24T10:15:00.000Z';

describe('runCanary', () => {
  it('should ask for one canary per channel, in order, with the run time', async () => {
    const request = vi.fn<(req: CanaryRequest) => Promise<void>>().mockResolvedValue(undefined);

    await runCanary({ channels: ['EMAIL', 'SMS'] }, AT, request);

    expect(request.mock.calls).toEqual([
      [{ channel: 'EMAIL', requestedAt: AT }],
      [{ channel: 'SMS', requestedAt: AT }],
    ]);
  });

  it('should still ask for the other channels when one request fails, then fail the run', async () => {
    const request = vi
      .fn<(req: CanaryRequest) => Promise<void>>()
      .mockRejectedValueOnce(new Error('NATS unavailable'))
      .mockResolvedValue(undefined);

    await expect(runCanary({ channels: ['EMAIL', 'PUSH'] }, AT, request)).rejects.toThrow(
      'Canary request failed for EMAIL',
    );
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith({ channel: 'PUSH', requestedAt: AT });
  });

  it('should ask for nothing when no channel is listed', async () => {
    const request = vi.fn<(req: CanaryRequest) => Promise<void>>();

    await runCanary({ channels: [] }, AT, request);

    expect(request).not.toHaveBeenCalled();
  });
});
