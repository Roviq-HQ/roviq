import { ConfigService } from '@nestjs/config';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import { CryptoService } from '@roviq/ee-payments';
import { requestContext } from '@roviq/request-context';
import { createMock } from '@roviq/testing';
import { describe, expect, it, vi } from 'vitest';
import { GatewayConfigRepository } from '../repositories/gateway-config.repository';
import { GatewayConfigService } from '../reseller/gateway-config.service';

const CTX: import('@roviq/request-context').RequestContext = {
  userId: 'user-1',
  tenantId: null,
  resellerId: 'reseller-1',
  scope: 'reseller',
  impersonatorId: null,
  correlationId: 'test',
};

function setup() {
  const repo = createMock<GatewayConfigRepository>();
  const crypto = createMock<CryptoService>({
    encrypt: vi.fn().mockReturnValue('encrypted'),
    decrypt: vi.fn().mockReturnValue({}),
  });
  const config = createMock<ConfigService>({ get: vi.fn().mockReturnValue('https://api.test') });
  return { service: new GatewayConfigService(repo, crypto, config), repo };
}

const row = (provider: string) => ({
  id: 'cfg-1',
  resellerId: 'reseller-1',
  provider,
  status: 'ACTIVE',
  displayName: null,
  isDefault: false,
  testMode: false,
  supportedMethods: [],
  credentials: 'encrypted',
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

async function errorOf(promise: Promise<unknown>) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(BusinessException);
  return (error as BusinessException).code;
}

describe('GatewayConfigService default gateway', () => {
  describe('createConfig', () => {
    it('should pass isDefault: true to the repository for a normal gateway', () =>
      requestContext.run(CTX, async () => {
        const { service, repo } = setup();
        repo.create.mockResolvedValue(row('RAZORPAY'));

        await service.createConfig('reseller-1', {
          provider: 'RAZORPAY',
          credentials: { RAZORPAY_KEY_ID: 'k' },
          isDefault: true,
        });

        expect(repo.create).toHaveBeenCalledTimes(1);
        expect(repo.create.mock.calls[0]?.[1].isDefault).toBe(true);
      }));

    it('should reject UPI_DIRECT as the default with BAD_REQUEST', () =>
      requestContext.run(CTX, async () => {
        const { service, repo } = setup();

        const code = await errorOf(
          service.createConfig('reseller-1', {
            provider: 'UPI_DIRECT',
            credentials: { VPA: 'a@upi' },
            isDefault: true,
          }),
        );

        expect(code).toBe(ErrorCode.BAD_REQUEST);
        expect(repo.create).not.toHaveBeenCalled();
      }));

    it('should allow UPI_DIRECT when it is not the default', () =>
      requestContext.run(CTX, async () => {
        const { service, repo } = setup();
        repo.create.mockResolvedValue(row('UPI_DIRECT'));

        await service.createConfig('reseller-1', {
          provider: 'UPI_DIRECT',
          credentials: { VPA: 'a@upi' },
          isDefault: false,
        });

        expect(repo.create.mock.calls[0]?.[1].isDefault).toBe(false);
      }));
  });

  describe('updateConfig', () => {
    it('should reject making an existing UPI_DIRECT config the default', () =>
      requestContext.run(CTX, async () => {
        const { service, repo } = setup();
        repo.findById.mockResolvedValue(row('UPI_DIRECT'));

        const code = await errorOf(
          service.updateConfig('reseller-1', 'cfg-1', { isDefault: true }),
        );

        expect(code).toBe(ErrorCode.BAD_REQUEST);
        expect(repo.update).not.toHaveBeenCalled();
      }));

    it('should pass isDefault: true to the repository for a normal gateway', () =>
      requestContext.run(CTX, async () => {
        const { service, repo } = setup();
        repo.findById.mockResolvedValue(row('CASHFREE'));
        repo.update.mockResolvedValue(row('CASHFREE'));

        await service.updateConfig('reseller-1', 'cfg-1', { isDefault: true });

        expect(repo.update).toHaveBeenCalledWith('reseller-1', 'cfg-1', { isDefault: true });
      }));

    it('should not look the config up when isDefault is not being set', () =>
      requestContext.run(CTX, async () => {
        const { service, repo } = setup();
        repo.update.mockResolvedValue(row('UPI_DIRECT'));

        await service.updateConfig('reseller-1', 'cfg-1', { displayName: 'UPI' });

        expect(repo.findById).not.toHaveBeenCalled();
      }));
  });
});
