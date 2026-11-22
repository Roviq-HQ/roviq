import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DrizzleDB } from '@roviq/database';
import { EMBEDDED_WORKER_RESTART_DELAY_MS, EmbeddedTemporalWorker } from '@roviq/temporal';
import { ChannelAdapters } from '../delivery/adapters/channel-adapters';
import { ChannelSender } from '../delivery/channel-sender';
import { ConsentGate } from '../delivery/consent-gate';
import { ContactReadDrizzleRepository } from '../repositories/contact-read.drizzle-repository';
import { NotificationWriteDrizzleRepository } from '../repositories/notification-write.drizzle-repository';
import { createNotificationActivities } from './notification.activities';
import { notificationWorkflowsPath } from './notification.workflows-path';
import { NOTIFICATION_TASK_QUEUE } from './notification-workflow.types';

/**
 * Runs the delivery and digest workflows (ROV-314) in notification-service when
 * NOTIFICATION_WORKER_ENABLED is 'true'. Without it in-app rows are still written, but no
 * email, push, SMS or WhatsApp message of a non-secret type leaves.
 */
@Injectable()
export class NotificationWorkerService extends EmbeddedTemporalWorker {
  constructor(
    config: ConfigService,
    private readonly adapters: ChannelAdapters,
    private readonly consent: ConsentGate,
  ) {
    super(config, {
      flag: 'NOTIFICATION_WORKER_ENABLED',
      label: 'Notification worker',
      taskQueue: NOTIFICATION_TASK_QUEUE,
      loggerName: NotificationWorkerService.name,
      restartDelayMs: EMBEDDED_WORKER_RESTART_DELAY_MS,
    });
  }

  protected createActivities(db: DrizzleDB) {
    const sender = new ChannelSender(
      this.adapters,
      this.consent,
      new ContactReadDrizzleRepository(db),
      new NotificationWriteDrizzleRepository(db),
    );
    return { ...createNotificationActivities(sender) };
  }

  protected workflowsPath(): string {
    return notificationWorkflowsPath();
  }
}
