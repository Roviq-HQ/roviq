import { describe, expect, it, vi } from 'vitest';
import { type ChannelGateChecks, evaluateChannelGate } from '../channel-gate';

function checks(overrides: Partial<ChannelGateChecks> = {}): ChannelGateChecks {
  return {
    channelEnabled: true,
    consents: vi.fn().mockResolvedValue(true),
    hasProvider: true,
    resolveAddresses: vi.fn().mockResolvedValue(['guardian@example.in']),
    ...overrides,
  };
}

describe('evaluateChannelGate', () => {
  it('should open with the resolved addresses when every check passes', async () => {
    await expect(evaluateChannelGate(checks())).resolves.toEqual({
      open: true,
      addresses: ['guardian@example.in'],
    });
  });

  it('should report channel_disabled first and look nothing up', async () => {
    const gate = checks({ channelEnabled: false, hasProvider: false });

    await expect(evaluateChannelGate(gate)).resolves.toEqual({
      open: false,
      reason: 'channel_disabled',
    });
    expect(gate.consents).not.toHaveBeenCalled();
    expect(gate.resolveAddresses).not.toHaveBeenCalled();
  });

  it('should report no_consent before no_provider', async () => {
    const gate = checks({ consents: vi.fn().mockResolvedValue(false), hasProvider: false });

    await expect(evaluateChannelGate(gate)).resolves.toEqual({ open: false, reason: 'no_consent' });
    expect(gate.resolveAddresses).not.toHaveBeenCalled();
  });

  it('should report no_provider before reading addresses', async () => {
    const gate = checks({ hasProvider: false, resolveAddresses: vi.fn().mockResolvedValue([]) });

    await expect(evaluateChannelGate(gate)).resolves.toEqual({
      open: false,
      reason: 'no_provider',
    });
    expect(gate.resolveAddresses).not.toHaveBeenCalled();
  });

  it('should report no_address when the recipient has none on the channel', async () => {
    const gate = checks({ resolveAddresses: vi.fn().mockResolvedValue([]) });

    await expect(evaluateChannelGate(gate)).resolves.toEqual({ open: false, reason: 'no_address' });
  });
});
