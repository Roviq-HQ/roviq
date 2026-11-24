import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DrizzleDB } from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import { EMBEDDED_WORKER_RESTART_DELAY_MS, EmbeddedTemporalWorker } from '@roviq/temporal';
import { Client, Connection } from '@temporalio/client';
import { ChannelAdapters } from '../delivery/adapters/channel-adapters';
import { ChannelSender } from '../delivery/channel-sender';
import { ConsentGate } from '../delivery/consent-gate';
import { Clock, WhatsAppRoute } from '../delivery/whatsapp/whatsapp-route';
import { ContactReadDrizzleRepository } from '../repositories/contact-read.drizzle-repository';
import { MessagingSenderDrizzleRepository } from '../repositories/messaging-sender.drizzle-repository';
import { NotificationWriteDrizzleRepository } from '../repositories/notification-write.drizzle-repository';
import { RecipientReadDrizzleRepository } from '../repositories/recipient-read.drizzle-repository';
import { DeliveryCanary } from '../services/delivery-canary.service';
import { NotificationMetrics } from '../telemetry/notification-metrics';
import { createCanaryActivities } from './canary.activities';
import { CANARY_SCHEDULE_ID, syncCanarySchedule } from './canary.schedule';
import { createNotificationActivities } from './notification.activities';
import { notificationWorkflowsPath } from './notification.workflows-path';
import { NOTIFICATION_TASK_QUEUE } from './notification-workflow.types';

/**
 * Runs the flow and digest workflows (ROV-314, ROV-332) in notification-service when
 * NOTIFICATION_WORKER_ENABLED is 'true'. Without it in-app rows are still written, but no
 * email, push, SMS or WhatsApp message of a non-secret type leaves. It also keeps the delivery
 * canary's schedule (ROV-329) in line with NOTIFICATION_CANARY_CHANNELS.
 */
@Injectable()
export class NotificationWorkerService extends EmbeddedTemporalWorker {
  constructor(
    config: ConfigService,
    private readonly adapters: ChannelAdapters,
    private readonly consent: ConsentGate,
    private readonly metrics: NotificationMetrics,
    private readonly eventBus: EventBusService,
    private readonly canary: DeliveryCanary,
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
    const recipients = new RecipientReadDrizzleRepository(db);
    const writes = new NotificationWriteDrizzleRepository(db);
    const sender = new ChannelSender(
      this.adapters,
      this.consent,
      new ContactReadDrizzleRepository(db),
      writes,
      new WhatsAppRoute(new MessagingSenderDrizzleRepository(db), recipients, new Clock()),
      this.metrics,
    );
    return {
      ...createNotificationActivities({ sender, recipients, writes }),
      ...createCanaryActivities(this.eventBus, this.canary.settings?.userId ?? null),
    };
  }

  protected workflowsPath(): string {
    return notificationWorkflowsPath();
  }

  /** The worker keeps running when the schedule cannot be brought up to date; the error is logged. */
  protected override async afterStart(address: string): Promise<void> {
    const connection = await Connection.connect({ address });
    try {
      await syncCanarySchedule(
        new Client({ connection }).schedule,
        this.canary.settings?.channels ?? null,
        this.logger,
      );
    } catch (err) {
      throw new Error(`Canary schedule ${CANARY_SCHEDULE_ID} could not be brought up to date`, {
        cause: err,
      });
    } finally {
      await connection.close();
    }
  }
}
