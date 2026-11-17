import { Test, type TestingModule } from '@nestjs/testing';
import type { InstituteContext } from '@roviq/common-types';
import { REDIS_CLIENT } from '@roviq/redis';
import { createMock } from '@roviq/testing';
import type Redis from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WsTicketController } from '../ws-ticket.controller';

const user: InstituteContext = {
  _scope: 'institute',
  scope: 'institute',
  userId: 'user-1',
  membershipId: 'membership-1',
  roleId: 'role-1',
  type: 'access',
  mustChangePassword: false,
  tenantId: 'tenant-1',
};

describe('WsTicketController', () => {
  let controller: WsTicketController;
  let set: ReturnType<typeof vi.fn<(key: string, value: string) => Promise<'OK'>>>;

  beforeEach(async () => {
    set = vi.fn(async () => 'OK' as const);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WsTicketController],
      providers: [{ provide: REDIS_CLIENT, useValue: createMock<Redis>({ set }) }],
    }).compile();

    controller = module.get<WsTicketController>(WsTicketController);
  });

  describe('getWsTicket', () => {
    it('should return the ticket it stored for the authenticated user', async () => {
      const result = await controller.getWsTicket({ user });

      expect(set).toHaveBeenCalledTimes(1);
      const [key, value] = set.mock.calls[0];
      expect(key).toBe(`ws-ticket:${result.ticket}`);
      expect(JSON.parse(value)).toEqual(user);
    });
  });
});
