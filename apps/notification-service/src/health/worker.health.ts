import { Injectable } from '@nestjs/common';
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { NotificationWorkerService } from '../workflows/notification.worker';

@Injectable()
export class NotificationWorkerHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly worker: NotificationWorkerService,
  ) {}

  isHealthy(): HealthIndicatorResult<'notificationWorker'> {
    const indicator = this.healthIndicatorService.check('notificationWorker');
    const state = this.worker.workerStatus;
    // `starting` counts as up: bundling and connecting take seconds, and a liveness probe that
    // fails then would restart a service that is about to work. A failed start ends in `stopped`.
    if (state === 'stopped') {
      return indicator.down({
        state,
        message: 'Temporal worker is not running; no email, push, SMS or WhatsApp is delivered',
      });
    }
    return indicator.up({ state });
  }
}
