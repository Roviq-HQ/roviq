import {
  BusinessException,
  ErrorCode,
  type InstituteContext,
  type PlatformContext,
  type ResellerContext,
} from '@roviq/common-types';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IdentityService, UserContact } from '../../../auth/identity.service';
import { InstituteFirstAdminFieldResolver } from '../institute-first-admin.resolver';

const USER_ID = '00000000-0000-7000-a000-000000000201';
const CONTACT: UserContact = {
  userId: USER_ID,
  email: 'meera@institute.test',
  username: 'meera@institute.test',
  mustChangePassword: true,
  firstName: 'Meera',
  lastName: 'Joshi',
  phone: { countryCode: '+91', number: '9812345678' },
};
const FIRST_ADMIN = {
  detailsWithheld: false,
  firstName: 'Meera',
  lastName: 'Joshi',
  email: 'meera@institute.test',
  phone: '9812345678',
};
const institute = { resellerId: 'reseller-1', firstAdminUserId: USER_ID };

const platform: PlatformContext = {
  _scope: 'platform',
  scope: 'platform',
  userId: 'u-1',
  membershipId: 'm-1',
  roleId: 'r-1',
  type: 'access',
};

function reseller(resellerId: string): ResellerContext {
  return { ...platform, _scope: 'reseller', scope: 'reseller', resellerId };
}

const instituteAdmin: InstituteContext = {
  ...platform,
  _scope: 'institute',
  scope: 'institute',
  tenantId: 'tenant-1',
};

describe('InstituteFirstAdminFieldResolver.firstAdmin', () => {
  let findUserContact: ReturnType<typeof vi.fn<IdentityService['findUserContact']>>;
  let wasCreatedByReseller: ReturnType<typeof vi.fn<IdentityService['wasCreatedByReseller']>>;
  let resolver: InstituteFirstAdminFieldResolver;

  beforeEach(() => {
    findUserContact = vi.fn<IdentityService['findUserContact']>(async () => CONTACT);
    wasCreatedByReseller = vi.fn<IdentityService['wasCreatedByReseller']>(async () => true);
    resolver = new InstituteFirstAdminFieldResolver(
      createMock<IdentityService>({ findUserContact, wasCreatedByReseller }),
    );
  });

  it('should return the full first admin to the platform without asking who created it', async () => {
    expect(await resolver.firstAdmin(institute, platform)).toEqual(FIRST_ADMIN);
    expect(findUserContact).toHaveBeenCalledWith(USER_ID);
    expect(wasCreatedByReseller).not.toHaveBeenCalled();
  });

  it('should return the full first admin to the owning reseller for an account its staff created', async () => {
    expect(await resolver.firstAdmin(institute, reseller('reseller-1'))).toEqual(FIRST_ADMIN);
    expect(wasCreatedByReseller).toHaveBeenCalledWith(USER_ID, 'reseller-1');
  });

  it('should give the owning reseller only the email of an account it did not create', async () => {
    wasCreatedByReseller.mockResolvedValue(false);

    const result = await resolver.firstAdmin(institute, reseller('reseller-1'));

    expect(result).toEqual({ email: CONTACT.email, detailsWithheld: true });
    const serialized = JSON.stringify(result);
    for (const hidden of ['Meera', 'Joshi', '9812345678']) {
      expect(serialized).not.toContain(hidden);
    }
  });

  it('should return null when the institute has none recorded', async () => {
    expect(
      await resolver.firstAdmin({ resellerId: 'reseller-1', firstAdminUserId: null }, platform),
    ).toBeNull();
    expect(findUserContact).not.toHaveBeenCalled();
  });

  it('should return null when the user no longer exists', async () => {
    findUserContact.mockResolvedValue(null);

    expect(await resolver.firstAdmin(institute, platform)).toBeNull();
  });

  it('should fall back to the Roviq ID and keep a foreign country code', async () => {
    findUserContact.mockResolvedValue({
      ...CONTACT,
      firstName: null,
      lastName: null,
      phone: { countryCode: '+44', number: '7700900123' },
    });

    expect(await resolver.firstAdmin(institute, platform)).toEqual({
      detailsWithheld: false,
      firstName: CONTACT.username,
      lastName: null,
      email: CONTACT.email,
      phone: '+447700900123',
    });
  });

  it.each([
    ['another reseller', reseller('reseller-2')],
    ['an institute-scope user', instituteAdmin],
  ])('should refuse %s without reading the user', async (_who, user) => {
    const thrown = await resolver.firstAdmin(institute, user).then(
      () => null,
      (err: unknown) => err,
    );

    expect(thrown).toBeInstanceOf(BusinessException);
    expect(thrown instanceof BusinessException && thrown.code).toBe(ErrorCode.FORBIDDEN);
    expect(findUserContact).not.toHaveBeenCalled();
  });
});
