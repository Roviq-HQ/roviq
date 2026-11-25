import { ErrorCode, type MessagingSenderStatus, type PlatformContext } from '@roviq/common-types';
import type { MessagingTokenCipher } from '@roviq/crypto';
import type { EventBusService } from '@roviq/event-bus';
import { createMock } from '@roviq/testing';
import type Redis from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { AdminMessagingService } from '../admin-messaging.service';
import type { RegisterMessagingSenderInput } from '../dto/messaging-sender.dto';
import type { AdminMessagingRepository } from '../repositories/admin-messaging.repository';
import type { MessagingSenderRecord } from '../repositories/types';
import type { AccountCheck, WhatsAppAccountCheck } from '../whatsapp-account-check';

const TOKEN = 'unit-spec-secret-token';
const CIPHERTEXT = Buffer.from('sealed');
const ID = '00000000-0000-7000-a000-0000000000aa';
const TENANT = '00000000-0000-7000-a000-0000000000bb';
const ACCOUNT = '900000000000777';

const ctx: PlatformContext = {
  _scope: 'platform',
  scope: 'platform',
  userId: '00000000-0000-7000-a000-0000000000cc',
  membershipId: '00000000-0000-7000-a000-0000000000dd',
  roleId: '00000000-0000-7000-a000-0000000000ee',
  type: 'access',
};

function sender(overrides: Partial<MessagingSenderRecord> = {}): MessagingSenderRecord {
  return {
    id: ID,
    scope: 'institute',
    tenantId: TENANT,
    providerNumberId: 'pn-1',
    providerAccountId: ACCOUNT,
    displayNumber: '+919876543210',
    status: 'ACTIVE',
    dailyCap: 100,
    instituteDailyCap: null,
    messagesPerSecond: 10,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    ...overrides,
  };
}

function setup(repoOverrides: Partial<AdminMessagingRepository> = {}, check: AccountCheck = 'ok') {
  const repo = createMock<AdminMessagingRepository>(repoOverrides);
  const cipher = createMock<MessagingTokenCipher>({ encrypt: vi.fn(() => CIPHERTEXT) });
  const redis = createMock<Redis>({ del: vi.fn().mockResolvedValue(2) });
  const accounts = createMock<WhatsAppAccountCheck>({
    canManageTemplates: vi.fn().mockResolvedValue(check),
  });
  const eventBus = createMock<EventBusService>({ emit: vi.fn() });
  return {
    repo,
    cipher,
    redis,
    accounts,
    eventBus,
    service: new AdminMessagingService(repo, cipher, redis, accounts, eventBus),
  };
}

const input: RegisterMessagingSenderInput = {
  tenantId: TENANT,
  providerNumberId: 'pn-1',
  providerAccountId: ACCOUNT,
  displayNumber: '+919876543210',
  accessToken: TOKEN,
  dailyCap: 100,
};

describe('AdminMessagingService.register', () => {
  it('should hand the repository the ciphertext, never the token', async () => {
    const register = vi.fn(async () => ({ kind: 'ok' as const, sender: sender() }));
    const { service, cipher } = setup({ register });

    await expect(service.register(ctx, input)).resolves.toEqual(sender());

    expect(cipher.encrypt).toHaveBeenCalledWith(TOKEN);
    expect(register).toHaveBeenCalledWith(ctx, {
      tenantId: TENANT,
      providerNumberId: 'pn-1',
      providerAccountId: ACCOUNT,
      displayNumber: '+919876543210',
      accessTokenEncrypted: CIPHERTEXT,
      dailyCap: 100,
      instituteDailyCap: null,
    });
    expect(JSON.stringify(register.mock.calls)).not.toContain(TOKEN);
  });

  it('should register the platform sender when tenantId is absent', async () => {
    const register = vi.fn(async () => ({
      kind: 'ok' as const,
      sender: sender({ scope: 'platform', tenantId: null, instituteDailyCap: 10 }),
    }));
    const { service } = setup({ register });

    await service.register(ctx, { ...input, tenantId: undefined, instituteDailyCap: 10 });

    expect(register).toHaveBeenCalledWith(ctx, {
      tenantId: null,
      providerNumberId: 'pn-1',
      providerAccountId: ACCOUNT,
      displayNumber: '+919876543210',
      accessTokenEncrypted: CIPHERTEXT,
      dailyCap: 100,
      instituteDailyCap: 10,
    });
  });

  it("should refuse instituteDailyCap on an institute's sender before writing", async () => {
    const { service, repo, cipher } = setup();

    await expect(service.register(ctx, { ...input, instituteDailyCap: 5 })).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    expect(repo.register).not.toHaveBeenCalled();
    expect(cipher.encrypt).not.toHaveBeenCalled();
  });

  it.each([
    ['institute_not_found' as const, ErrorCode.INSTITUTE_NOT_FOUND],
    ['sender_exists' as const, ErrorCode.MESSAGING_SENDER_EXISTS],
  ])('should turn %s into %s', async (kind, code) => {
    const { service } = setup({ register: vi.fn(async () => ({ kind })) });

    await expect(service.register(ctx, input)).rejects.toMatchObject({ code });
  });

  it('should keep the token out of the refusal message', async () => {
    const { service } = setup({
      register: vi.fn(async () => ({ kind: 'sender_exists' as const })),
    });

    const error = await service.register(ctx, input).catch((e: unknown) => e);

    expect(JSON.stringify(error)).not.toContain(TOKEN);
    expect(String(error)).not.toContain(TOKEN);
  });
});

describe('AdminMessagingService.update', () => {
  it('should answer MESSAGING_SENDER_NOT_FOUND for a missing sender', async () => {
    const { service, repo } = setup({ findById: vi.fn(async () => null) });

    await expect(service.update(ctx, ID, { dailyCap: 5 })).rejects.toMatchObject({
      code: ErrorCode.MESSAGING_SENDER_NOT_FOUND,
    });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("should refuse instituteDailyCap on an institute's sender", async () => {
    const { service, repo } = setup({ findById: vi.fn(async () => sender()) });

    await expect(service.update(ctx, ID, { instituteDailyCap: 5 })).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("should pass null through to clear the platform sender's share limit", async () => {
    const platform = sender({ scope: 'platform', tenantId: null, instituteDailyCap: 5 });
    const update = vi.fn(async () => ({ ...platform, instituteDailyCap: null }));
    const { service } = setup({ findById: vi.fn(async () => platform), update });

    await service.update(ctx, ID, { instituteDailyCap: null });

    expect(update).toHaveBeenCalledWith(ctx, ID, { instituteDailyCap: null });
  });

  it('should pass the messages per second through', async () => {
    const update = vi.fn(async () => sender({ messagesPerSecond: 80 }));
    const { service } = setup({ findById: vi.fn(async () => sender()), update });

    await service.update(ctx, ID, { messagesPerSecond: 80 });

    expect(update).toHaveBeenCalledWith(ctx, ID, { messagesPerSecond: 80 });
  });
});

describe('AdminMessagingService.rotateToken', () => {
  it('should store the new ciphertext', async () => {
    const replaceToken = vi.fn(async () => sender());
    const { service, cipher } = setup({ findById: vi.fn(async () => sender()), replaceToken });

    await service.rotateToken(ctx, ID, 'new-token');

    expect(cipher.encrypt).toHaveBeenCalledWith('new-token');
    expect(replaceToken).toHaveBeenCalledWith(ctx, ID, CIPHERTEXT);
  });

  it('should answer MESSAGING_SENDER_NOT_FOUND for a missing sender', async () => {
    const { service } = setup({ findById: vi.fn(async () => null) });

    await expect(service.rotateToken(ctx, ID, 'new-token')).rejects.toMatchObject({
      code: ErrorCode.MESSAGING_SENDER_NOT_FOUND,
    });
  });

  it('should refuse a token the provider will not let manage the account, and keep the old one', async () => {
    const replaceToken = vi.fn(async () => sender());
    const { service } = setup({ findById: vi.fn(async () => sender()), replaceToken }, 'refused');

    await expect(service.rotateToken(ctx, ID, 'new-token')).rejects.toMatchObject({
      code: ErrorCode.MESSAGING_TOKEN_CANNOT_MANAGE_TEMPLATES,
    });
    expect(replaceToken).not.toHaveBeenCalled();
  });
});

describe('AdminMessagingService WhatsApp templates (ROV-333)', () => {
  it('should check the token before storing anything, and ask for a sync after', async () => {
    const register = vi.fn(async () => ({ kind: 'ok' as const, sender: sender() }));
    const { service, accounts, eventBus } = setup({ register });

    await service.register(ctx, input);

    expect(accounts.canManageTemplates).toHaveBeenCalledWith(ACCOUNT, TOKEN);
    expect(eventBus.emit).toHaveBeenCalledWith('NOTIFICATION.whatsapp_templates.sync_requested', {
      providerAccountId: ACCOUNT,
      tenantId: null,
    });
  });

  it.each([
    ['refused' as const, ErrorCode.MESSAGING_TOKEN_CANNOT_MANAGE_TEMPLATES],
    ['unreachable' as const, ErrorCode.MESSAGING_PROVIDER_UNREACHABLE],
  ])('should store nothing and ask for no sync when the check answers %s', async (check, code) => {
    const { service, repo, eventBus } = setup({}, check);

    await expect(service.register(ctx, input)).rejects.toMatchObject({ code });
    expect(repo.register).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('should refuse a sync request for a sender without an account', async () => {
    const { service, eventBus } = setup({
      findById: vi.fn(async () => sender({ providerAccountId: null })),
    });

    await expect(service.syncTemplates(ctx, ID)).rejects.toMatchObject({
      code: ErrorCode.MESSAGING_SENDER_ACCOUNT_MISSING,
    });
    expect(eventBus.emit).not.toHaveBeenCalled();
  });
});

describe('AdminMessagingService status transitions', () => {
  const cases: ['pause' | 'activate' | 'block', MessagingSenderStatus, MessagingSenderStatus][] = [
    ['pause', 'ACTIVE', 'PAUSED'],
    ['activate', 'PAUSED', 'ACTIVE'],
    ['activate', 'BLOCKED', 'ACTIVE'],
    ['block', 'ACTIVE', 'BLOCKED'],
    ['block', 'PAUSED', 'BLOCKED'],
  ];

  it.each(cases)('%s should move %s to %s', async (method, from, to) => {
    const setStatus = vi.fn(async () => sender({ status: to }));
    const { service } = setup({ findById: vi.fn(async () => sender({ status: from })), setStatus });

    await expect(service[method](ctx, ID)).resolves.toEqual(sender({ status: to }));
    expect(setStatus).toHaveBeenCalledWith(ctx, ID, from, to);
  });

  it.each([
    ['pause' as const, 'PAUSED' as const],
    ['pause' as const, 'BLOCKED' as const],
    ['activate' as const, 'ACTIVE' as const],
    ['block' as const, 'BLOCKED' as const],
  ])('%s should refuse a sender in %s', async (method, from) => {
    const { service, repo } = setup({ findById: vi.fn(async () => sender({ status: from })) });

    await expect(service[method](ctx, ID)).rejects.toMatchObject({
      code: ErrorCode.INVALID_STATE_TRANSITION,
    });
    expect(repo.setStatus).not.toHaveBeenCalled();
  });

  it("should clear the sender's breaker and throttle on activate", async () => {
    const { service, redis } = setup({
      findById: vi.fn(async () => sender({ status: 'BLOCKED' })),
      setStatus: vi.fn(async () => sender({ status: 'ACTIVE' })),
    });

    await service.activate(ctx, ID);

    expect(redis.del).toHaveBeenCalledWith(
      `notification:breaker:sender:${ID}`,
      `notification:sender-throttle:${ID}`,
    );
  });

  it('should clear nothing when activate is refused', async () => {
    const { service, redis } = setup({ findById: vi.fn(async () => sender({ status: 'ACTIVE' })) });

    await expect(service.activate(ctx, ID)).rejects.toMatchObject({
      code: ErrorCode.INVALID_STATE_TRANSITION,
    });
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('should answer INVALID_STATE_TRANSITION when the status changed meanwhile', async () => {
    const { service } = setup({
      findById: vi.fn(async () => sender({ status: 'ACTIVE' })),
      setStatus: vi.fn(async () => null),
    });

    await expect(service.pause(ctx, ID)).rejects.toMatchObject({
      code: ErrorCode.INVALID_STATE_TRANSITION,
    });
  });
});

describe('AdminMessagingService.delete', () => {
  it('should answer MESSAGING_SENDER_NOT_FOUND when nothing was deleted', async () => {
    const { service } = setup({ delete: vi.fn(async () => false) });

    await expect(service.delete(ctx, ID)).rejects.toMatchObject({
      code: ErrorCode.MESSAGING_SENDER_NOT_FOUND,
    });
  });
});

describe('AdminMessagingService.smsUsage', () => {
  it("should return the repository's rows for the month as they are", async () => {
    const rows = [
      { tenantId: null, type: 'IMPERSONATION_OTP', sentCount: 2 },
      { tenantId: TENANT, type: 'FEE_REMINDER', sentCount: 5 },
    ];
    const smsUsage = vi.fn(async () => rows);
    const { service } = setup({ smsUsage });

    await expect(service.smsUsage(ctx, '2032-03')).resolves.toEqual(rows);
    expect(smsUsage).toHaveBeenCalledWith(ctx, '2032-03');
  });
});
