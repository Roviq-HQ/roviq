import { Inject, Injectable, Logger } from '@nestjs/common';
import { NOTIFICATION_REDIS_KEYS, REDIS_CLIENT } from '@roviq/redis';
import { TemporalClientService } from '@roviq/temporal';
import type Redis from 'ioredis';
import { registryHash } from '../delivery/whatsapp/template-submission';
import { MessagingSenderRepository } from '../repositories/messaging-sender.repository';
import {
  NOTIFICATION_TASK_QUEUE,
  TEMPLATE_SYNC_REQUESTED_SIGNAL,
  TEMPLATE_SYNC_WORKFLOW_TYPE,
  templateSyncWorkflowId,
} from '../workflows/notification-workflow.types';

/** Starts the WhatsApp template sync of an account (ROV-333): one run per account at a time. */
@Injectable()
export class TemplateSyncStarter {
  private readonly logger = new Logger(TemplateSyncStarter.name);

  constructor(
    private readonly temporal: TemporalClientService,
    private readonly senders: MessagingSenderRepository,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** A run already going is told to read the provider's list once more; else one starts. */
  async start(providerAccountId: string): Promise<void> {
    await this.temporal.signalWithStart(TEMPLATE_SYNC_WORKFLOW_TYPE, {
      workflowId: templateSyncWorkflowId(providerAccountId),
      taskQueue: NOTIFICATION_TASK_QUEUE,
      args: [{ providerAccountId }],
      signal: TEMPLATE_SYNC_REQUESTED_SIGNAL,
      signalArgs: [null],
    });
  }

  /** At start: when the code's templates changed since the last sync, sync every account. */
  async startIfRegistryChanged(): Promise<void> {
    const hash = registryHash();
    const key = NOTIFICATION_REDIS_KEYS.NOTIFICATION_TEMPLATE_REGISTRY_HASH;
    if ((await this.redis.get(key)) === hash) return;
    const accounts = await this.senders.listAccounts();
    for (const account of accounts) await this.start(account);
    await this.redis.set(key, hash);
    this.logger.log(
      `WhatsApp template registry changed: sync started for ${accounts.length} account(s)`,
    );
  }
}
