import { BusinessException, ErrorCode } from '@roviq/common-types';
import { createMock } from '@roviq/testing';
import type Redis from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IdentityService } from '../../../auth/identity.service';
import {
  SignInDetailsService,
  type SignInTarget,
  welcomeAddresses,
} from '../sign-in-details.service';

const TENANT = '01a2075e-0000-7000-8000-000000000001';
const ACTOR = '01a2075e-0000-7000-8000-000000000002';

function target(overrides: Partial<SignInTarget> = {}): SignInTarget {
  return {
    userId: '01a2075e-0000-7000-8000-000000000003',
    username: 'staff-01a2075e-abc',
    email: 'kiran.das@example.in',
    phone: { countryCode: '+91', number: '9876543210' },
    firstName: 'Kiran',
    lastName: 'Das',
    mustChangePassword: true,
    ...overrides,
  };
}

/** Keys only, no expiry: enough for SET NX and INCR within one test. */
function fakeRedis() {
  const store = new Map<string, number>();
  return createMock<Redis>({
    set: vi.fn(async (key: string) => {
      if (store.has(key)) return null;
      store.set(key, 1);
      return 'OK';
    }),
    incr: vi.fn(async (key: string) => {
      const next = (store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    }),
    expire: vi.fn(async () => 1),
  });
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof BusinessException) return err.code;
    throw err;
  }
  return null;
}

describe('welcomeAddresses', () => {
  it('should drop a placeholder email and keep the phone', () => {
    expect(
      welcomeAddresses('guardian-ab12@roviq.placeholder', { countryCode: '+91', number: '9' }),
    ).toEqual({ email: null, phone: { countryCode: '+91', number: '9' } });
  });

  it('should keep a real email when there is no phone', () => {
    expect(welcomeAddresses('a@example.in', undefined)).toEqual({
      email: 'a@example.in',
      phone: null,
    });
  });
});

describe('SignInDetailsService', () => {
  let identity: ReturnType<typeof createMock<IdentityService>>;
  let service: SignInDetailsService;

  beforeEach(() => {
    identity = createMock<IdentityService>({
      reissueTempPassword: vi.fn().mockResolvedValue('Tmp-new-1'),
      sendWelcomeNotification: vi.fn(),
    });
    service = new SignInDetailsService(identity, fakeRedis());
  });

  describe('sendOnCreate', () => {
    it('should send nothing to a person with only a placeholder email', () => {
      const sent = service.sendOnCreate({
        tenantId: TENANT,
        userId: target().userId,
        username: 'staff-x',
        email: 'staff-x@roviq.placeholder',
        phone: undefined,
        firstName: 'Kiran',
        lastName: null,
        tempPassword: 'Tmp-1',
      });

      expect(sent).toBe(false);
      expect(identity.sendWelcomeNotification).not.toHaveBeenCalled();
    });

    it('should send with the phone only when the email is missing', () => {
      service.sendOnCreate({
        tenantId: TENANT,
        userId: target().userId,
        username: 'guardian-x',
        email: undefined,
        phone: { countryCode: '+91', number: '9876543210' },
        firstName: 'Sunita',
        lastName: null,
        tempPassword: 'Tmp-1',
      });

      expect(identity.sendWelcomeNotification).toHaveBeenCalledWith({
        userId: target().userId,
        username: 'guardian-x',
        email: null,
        phone: { countryCode: '+91', number: '9876543210' },
        firstName: 'Sunita',
        lastName: undefined,
        tempPassword: 'Tmp-1',
        scope: 'institute',
        tenantId: TENANT,
      });
    });
  });

  describe('resend', () => {
    it('should refuse a person with no real contact before issuing a password', async () => {
      const code = await codeOf(
        service.resend(TENANT, target({ email: 'x@roviq.placeholder', phone: null }), ACTOR),
      );

      expect(code).toBe(ErrorCode.SIGN_IN_CONTACT_MISSING);
      expect(identity.reissueTempPassword).not.toHaveBeenCalled();
    });

    it('should refuse a person who has signed in before issuing a password', async () => {
      const code = await codeOf(
        service.resend(TENANT, target({ mustChangePassword: false }), ACTOR),
      );

      expect(code).toBe(ErrorCode.SIGN_IN_ALREADY_COMPLETED);
      expect(identity.reissueTempPassword).not.toHaveBeenCalled();
    });

    it('should refuse when the password was set between the read and the write', async () => {
      identity.reissueTempPassword.mockResolvedValue(null);

      const code = await codeOf(service.resend(TENANT, target(), ACTOR));

      expect(code).toBe(ErrorCode.SIGN_IN_ALREADY_COMPLETED);
      expect(identity.sendWelcomeNotification).not.toHaveBeenCalled();
    });

    it('should send the new password to the real addresses only', async () => {
      await service.resend(TENANT, target({ email: 'k@roviq.placeholder' }), ACTOR);

      expect(identity.reissueTempPassword).toHaveBeenCalledWith(target().userId, ACTOR);
      expect(identity.sendWelcomeNotification).toHaveBeenCalledWith({
        userId: target().userId,
        username: 'staff-01a2075e-abc',
        email: null,
        phone: { countryCode: '+91', number: '9876543210' },
        firstName: 'Kiran',
        lastName: 'Das',
        tempPassword: 'Tmp-new-1',
        scope: 'institute',
        tenantId: TENANT,
      });
    });

    it('should refuse a second resend within a minute without issuing a password', async () => {
      await service.resend(TENANT, target(), ACTOR);

      const code = await codeOf(service.resend(TENANT, target(), ACTOR));

      expect(code).toBe(ErrorCode.TOO_MANY_REQUESTS);
      expect(identity.reissueTempPassword).toHaveBeenCalledTimes(1);
    });
  });
});
