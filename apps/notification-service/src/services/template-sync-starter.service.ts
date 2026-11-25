import { Inject, Injectable, Logger } from '@nestjs/common';
import { NOTIFICATION_REDIS_KEYS, REDIS_CLIENT } from '@roviq/redis';
import { TemporalClientService } from '@roviq/temporal';
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import type Redis from 'ioredis';
import { registryHash } from '../delivery/whatsapp/template-submission';
import { MessagingSenderRepository } from '../repositories/messaging-sender.repository';
import {
  NOTIFICATION_TASK_QUEUE,
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

  /** False when a sync of the account is already running: it covers this request too. */
  async start(providerAccountId: string): Promise<boolean> {
    try {
      await this.temporal.startWorkflow(TEMPLATE_SYNC_WORKFLOW_TYPE, {
        workflowId: templateSyncWorkflowId(providerAccountId),
        taskQueue: NOTIFICATION_TASK_QUEUE,
        args: [{ providerAccountId }],
      });
      return true;
    } catch (err) {
      if (err instanceof WorkflowExecutionAlreadyStartedError) return false;
      throw err;
    }
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
