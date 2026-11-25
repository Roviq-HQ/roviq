import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ConsentReadRepository,
  GuardianConsentState,
} from '../../repositories/consent-read.repository';
import { type ConsentQuery, GuardianConsentGate } from '../consent-gate';

const query = (overrides: Partial<ConsentQuery> = {}): ConsentQuery => ({
  recipientUserId: 'user-guardian-1',
  channel: 'WHATSAPP',
  type: 'ATTENDANCE_ABSENT',
  tenantId: 'tenant-1',
  studentMembershipId: 'membership-student-1',
  ...overrides,
});

describe('GuardianConsentGate', () => {
  let consents: ReturnType<typeof createMock<ConsentReadRepository>>;
  let gate: GuardianConsentGate;

  const withState = (state: GuardianConsentState) => {
    consents.guardianConsent.mockResolvedValue(state);
  };

  beforeEach(() => {
    consents = createMock<ConsentReadRepository>({ guardianConsent: vi.fn() });
    gate = new GuardianConsentGate(consents);
  });

  it('should ask for the WHATSAPP_COMMUNICATION purpose of the student the message is about', async () => {
    withState('granted');

    await expect(gate.allows(query())).resolves.toBe(true);
    expect(consents.guardianConsent).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      recipientUserId: 'user-guardian-1',
      studentMembershipId: 'membership-student-1',
      purpose: 'WHATSAPP_COMMUNICATION',
    });
  });

  it.each([
    ['missing', false],
    ['withdrawn', false],
    ['granted', true],
    ['not_guardian', true],
  ] as const)('should answer %s consent with %s', async (state, allowed) => {
    withState(state);

    await expect(gate.allows(query())).resolves.toBe(allowed);
  });

  it.each(['EMAIL', 'SMS', 'PUSH'] as const)('should not gate %s', async (channel) => {
    await expect(gate.allows(query({ channel }))).resolves.toBe(true);
    expect(consents.guardianConsent).not.toHaveBeenCalled();
  });

  it('should not gate a message outside an institute', async () => {
    await expect(gate.allows(query({ tenantId: null }))).resolves.toBe(true);
    expect(consents.guardianConsent).not.toHaveBeenCalled();
  });
});
