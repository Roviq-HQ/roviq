import { BusinessException, ErrorCode } from '@roviq/common-types';
import type { DrizzleDB } from '@roviq/database';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IdentityService } from '../../../auth/identity.service';
import { ResellerTeamService } from '../reseller-team.service';

const roleLookup = vi.hoisted(() => ({ rows: [] as { id: string }[] }));

vi.mock('@roviq/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@roviq/database')>();
  const tx = {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(roleLookup.rows) }) }),
    }),
  };
  return {
    ...actual,
    withAdmin: vi.fn((_db: unknown, _ctx: unknown, fn: (tx: unknown) => unknown) => fn(tx)),
  };
});

const RESELLER_ID = '11111111-1111-4111-a111-111111111111';
const ROLE_ID = '33333333-3333-4333-a333-333333333333';
const ACTOR_ID = '22222222-2222-4222-a222-222222222222';
const INPUT = { username: 'priya.nair', email: 'priya.nair@roviq.test', roleId: ROLE_ID };

describe('ResellerTeamService.invite', () => {
  let identityService: IdentityService;
  let service: ResellerTeamService;

  beforeEach(() => {
    identityService = createMock<IdentityService>({
      createUserWithMembership: vi.fn().mockResolvedValue({
        userId: 'new-user-id',
        tempPassword: 'temp-pass',
        membershipId: 'new-membership-id',
        scope: 'reseller',
      }),
    });
    service = new ResellerTeamService(createMock<DrizzleDB>(), identityService);
  });

  it('should reject a role that is not owned by the inviting reseller', async () => {
    roleLookup.rows = [];

    const promise = service.invite(RESELLER_ID, ACTOR_ID, INPUT);

    await expect(promise).rejects.toBeInstanceOf(BusinessException);
    await expect(promise).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    expect(identityService.createUserWithMembership).not.toHaveBeenCalled();
  });

  it('should create the membership when the role belongs to the reseller', async () => {
    roleLookup.rows = [{ id: ROLE_ID }];

    const result = await service.invite(RESELLER_ID, ACTOR_ID, INPUT);

    expect(result).toEqual({ membershipId: 'new-membership-id' });
    expect(identityService.createUserWithMembership).toHaveBeenCalledWith({
      username: 'priya.nair',
      email: 'priya.nair@roviq.test',
      firstName: undefined,
      lastName: undefined,
      scope: 'reseller',
      resellerId: RESELLER_ID,
      roleId: ROLE_ID,
      actorId: ACTOR_ID,
    });
  });
});
