import { NOTIFICATION_REDIS_KEYS } from '@roviq/redis';
import type { TemporalClientService } from '@roviq/temporal';
import { createMock } from '@roviq/testing';
import type Redis from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { registryHash } from '../../delivery/whatsapp/template-submission';
import { TemplateSyncListener } from '../../listeners/template-sync.listener';
import type { MessagingSenderRepository } from '../../repositories/messaging-sender.repository';
import { TemplateSyncStarter } from '../template-sync-starter.service';

function setup(storedHash: string | null) {
  const temporal = createMock<TemporalClientService>({
    signalWithStart: vi.fn().mockResolvedValue('run-1'),
  });
  const senders = createMock<MessagingSenderRepository>({
    listAccounts: vi.fn().mockResolvedValue(['acct-1', 'acct-2']),
  });
  const redis = createMock<Redis>({
    get: vi.fn().mockResolvedValue(storedHash),
    set: vi.fn().mockResolvedValue('OK'),
  });
  return { temporal, senders, redis, starter: new TemplateSyncStarter(temporal, senders, redis) };
}

describe('TemplateSyncStarter', () => {
  it('should start a run of the account, or tell the one going to read the list again', async () => {
    const { starter, temporal } = setup(null);

    await starter.start('acct-1');

    expect(temporal.signalWithStart).toHaveBeenCalledWith('WhatsAppTemplateSyncWorkflow', {
      workflowId: 'whatsapp-template-sync:acct-1',
      taskQueue: 'notifications',
      args: [{ providerAccountId: 'acct-1' }],
      signal: 'templateSyncRequested',
      signalArgs: [null],
    });
  });

  it('should sync every account at start when the registry changed, then remember it', async () => {
    const { starter, temporal, redis } = setup('an older hash');

    await starter.startIfRegistryChanged();

    expect(temporal.signalWithStart).toHaveBeenCalledTimes(2);
    expect(redis.set).toHaveBeenCalledWith(
      NOTIFICATION_REDIS_KEYS.NOTIFICATION_TEMPLATE_REGISTRY_HASH,
      registryHash(),
    );
  });

  it('should start nothing at start when the registry is the one last synced', async () => {
    const { starter, temporal, redis } = setup(registryHash());

    await starter.startIfRegistryChanged();

    expect(temporal.signalWithStart).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });
});

describe('TemplateSyncListener', () => {
  it("should start the account's sync from the gateway's request and refuse a bad payload", async () => {
    const starter = createMock<TemplateSyncStarter>({
      start: vi.fn().mockResolvedValue(undefined),
    });
    const listener = new TemplateSyncListener(starter);

    await listener.handle({ providerAccountId: 'acct-1', tenantId: null });
    await expect(listener.handle({ providerAccountId: '', tenantId: null })).rejects.toThrow();

    expect(starter.start).toHaveBeenCalledTimes(1);
    expect(starter.start).toHaveBeenCalledWith('acct-1');
  });
});
