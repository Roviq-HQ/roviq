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

  describe('sender checks', () => {
    const PHONE = '+919000000001';
    const QUIET_END = new Date('2026-11-24T01:30:00.000Z');

    function senderChecks(overrides: Partial<ChannelGateChecks> = {}) {
      return {
        channelEnabled: true,
        consents: vi.fn<ChannelGateChecks['consents']>().mockResolvedValue(true),
        hasProvider: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
        hasTemplate: vi.fn<NonNullable<ChannelGateChecks['hasTemplate']>>().mockResolvedValue(true),
        resolveAddresses: vi.fn<ChannelGateChecks['resolveAddresses']>().mockResolvedValue([PHONE]),
        optedOut: vi.fn<NonNullable<ChannelGateChecks['optedOut']>>().mockResolvedValue(false),
        quietUntil: vi.fn<NonNullable<ChannelGateChecks['quietUntil']>>().mockResolvedValue(null),
        capacity: vi.fn<NonNullable<ChannelGateChecks['capacity']>>().mockResolvedValue('ok'),
        ...overrides,
      };
    }

    it('should open when every sender check passes', async () => {
      await expect(evaluateChannelGate(senderChecks())).resolves.toEqual({
        open: true,
        addresses: [PHONE],
      });
    });

    it('should accept hasProvider as a function and refuse when it says no', async () => {
      const gate = senderChecks({ hasProvider: vi.fn().mockResolvedValue(false) });

      await expect(evaluateChannelGate(gate)).resolves.toEqual({
        open: false,
        reason: 'no_provider',
      });
      expect(gate.hasProvider).toHaveBeenCalledTimes(1);
      expect(gate.hasTemplate).not.toHaveBeenCalled();
      expect(gate.resolveAddresses).not.toHaveBeenCalled();
    });

    it('should not ask the provider before consent', async () => {
      const gate = senderChecks({ consents: vi.fn().mockResolvedValue(false) });

      await expect(evaluateChannelGate(gate)).resolves.toEqual({
        open: false,
        reason: 'no_consent',
      });
      expect(gate.hasProvider).not.toHaveBeenCalled();
    });

    it('should report no_template before reading addresses', async () => {
      const gate = senderChecks({ hasTemplate: vi.fn().mockResolvedValue(false) });

      await expect(evaluateChannelGate(gate)).resolves.toEqual({
        open: false,
        reason: 'no_template',
      });
      expect(gate.resolveAddresses).not.toHaveBeenCalled();
      expect(gate.optedOut).not.toHaveBeenCalled();
      expect(gate.quietUntil).not.toHaveBeenCalled();
      expect(gate.capacity).not.toHaveBeenCalled();
    });

    it('should report no_address before asking about an opt-out', async () => {
      const gate = senderChecks({ resolveAddresses: vi.fn().mockResolvedValue([]) });

      await expect(evaluateChannelGate(gate)).resolves.toEqual({
        open: false,
        reason: 'no_address',
      });
      expect(gate.optedOut).not.toHaveBeenCalled();
    });

    it('should report opted_out, asked with the resolved addresses', async () => {
      const gate = senderChecks({ optedOut: vi.fn().mockResolvedValue(true) });

      await expect(evaluateChannelGate(gate)).resolves.toEqual({
        open: false,
        reason: 'opted_out',
      });
      expect(gate.optedOut).toHaveBeenCalledWith([PHONE]);
      expect(gate.quietUntil).not.toHaveBeenCalled();
      expect(gate.capacity).not.toHaveBeenCalled();
    });

    it('should defer until quiet hours end without looking at the cap', async () => {
      const gate = senderChecks({ quietUntil: vi.fn().mockResolvedValue(QUIET_END) });

      await expect(evaluateChannelGate(gate)).resolves.toEqual({
        open: false,
        deferUntil: QUIET_END,
        deferReason: 'quiet_hours',
      });
      expect(gate.capacity).not.toHaveBeenCalled();
    });

    it('should report sender_cap when the sender is over its cap', async () => {
      const gate = senderChecks({ capacity: vi.fn().mockResolvedValue('over') });

      await expect(evaluateChannelGate(gate)).resolves.toEqual({
        open: false,
        reason: 'sender_cap',
      });
    });

    it('should defer when the capacity check asks to wait', async () => {
      const later = new Date('2026-11-23T11:00:00.000Z');
      const gate = senderChecks({ capacity: vi.fn().mockResolvedValue({ deferUntil: later }) });

      await expect(evaluateChannelGate(gate)).resolves.toEqual({
        open: false,
        deferUntil: later,
        deferReason: 'sender_cap',
      });
    });

    it('should open with the old behaviour when no sender check is given', async () => {
      const gate = checks({ hasProvider: vi.fn().mockResolvedValue(true) });

      await expect(evaluateChannelGate(gate)).resolves.toEqual({
        open: true,
        addresses: ['guardian@example.in'],
      });
    });
  });
});
