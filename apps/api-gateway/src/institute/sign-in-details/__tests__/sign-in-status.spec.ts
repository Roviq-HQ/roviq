import { describe, expect, it } from 'vitest';
import { deriveSignInState } from '../sign-in-status';

const at = (iso: string) => new Date(iso);

describe('deriveSignInState', () => {
  it('should report SIGNED_IN once the person has set a password, keeping the last send time', () => {
    expect(
      deriveSignInState({
        mustChangePassword: false,
        hasRealContact: true,
        latestPerChannel: [{ status: 'SENT', createdAt: at('2026-11-20T10:00:00Z') }],
      }),
    ).toEqual({ signInStatus: 'SIGNED_IN', signInDetailsSentAt: at('2026-11-20T10:00:00Z') });
  });

  it('should report DETAILS_SENT when one channel reached the provider and another failed', () => {
    expect(
      deriveSignInState({
        mustChangePassword: true,
        hasRealContact: true,
        latestPerChannel: [
          { status: 'FAILED', createdAt: at('2026-11-20T10:00:05Z') },
          { status: 'DELIVERED', createdAt: at('2026-11-20T10:00:09Z') },
        ],
      }),
    ).toEqual({ signInStatus: 'DETAILS_SENT', signInDetailsSentAt: at('2026-11-20T10:00:09Z') });
  });

  it('should report SEND_FAILED when no channel reached the provider and one failed', () => {
    expect(
      deriveSignInState({
        mustChangePassword: true,
        hasRealContact: true,
        latestPerChannel: [
          { status: 'FAILED', createdAt: at('2026-11-20T10:00:05Z') },
          { status: 'SKIPPED', createdAt: at('2026-11-20T10:00:06Z') },
        ],
      }),
    ).toEqual({ signInStatus: 'SEND_FAILED', signInDetailsSentAt: null });
  });

  it('should report NOT_SENT_NO_CONTACT for a person with no real email and no phone', () => {
    expect(
      deriveSignInState({ mustChangePassword: true, hasRealContact: false, latestPerChannel: [] }),
    ).toEqual({ signInStatus: 'NOT_SENT_NO_CONTACT', signInDetailsSentAt: null });
  });

  it('should report NOT_SENT when the person has an address but every channel was skipped', () => {
    expect(
      deriveSignInState({
        mustChangePassword: true,
        hasRealContact: true,
        latestPerChannel: [{ status: 'SKIPPED', createdAt: at('2026-11-20T10:00:00Z') }],
      }),
    ).toEqual({ signInStatus: 'NOT_SENT', signInDetailsSentAt: null });
  });
});
