import { ServiceUnavailableException } from '@nestjs/common';
import { HealthCheckService, HealthIndicatorService, TerminusModule } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import type { EmbeddedWorkerStatus } from '@roviq/temporal';
import { createMock } from '@roviq/testing';
import { describe, expect, it } from 'vitest';
import { NotificationWorkerService } from '../../workflows/notification.worker';
import { HealthController } from '../health.controller';
import { NotificationWorkerHealthIndicator } from '../worker.health';

// The real HealthCheckService turns a down indicator into the 503 body the container probe sees.
async function controllerWith(workerStatus: EmbeddedWorkerStatus) {
  const module = await Test.createTestingModule({
    imports: [TerminusModule.forRoot({ logger: false })],
  }).compile();
  const indicator = new NotificationWorkerHealthIndicator(
    module.get(HealthIndicatorService),
    createMock<NotificationWorkerService>({ workerStatus }),
  );
  return new HealthController(module.get(HealthCheckService), indicator);
}

describe('HealthController', () => {
  it('should be ok when the worker flag is off', async () => {
    const controller = await controllerWith('disabled');

    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      info: { notificationWorker: { status: 'up', state: 'disabled' } },
      error: {},
      details: { notificationWorker: { status: 'up', state: 'disabled' } },
    });
  });

  it('should be ok when the worker is running', async () => {
    const controller = await controllerWith('running');

    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      info: { notificationWorker: { status: 'up', state: 'running' } },
      error: {},
      details: { notificationWorker: { status: 'up', state: 'running' } },
    });
  });

  it('should be ok while the worker is starting, so a booting service is not restarted', async () => {
    const controller = await controllerWith('starting');

    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      info: { notificationWorker: { status: 'up', state: 'starting' } },
      error: {},
      details: { notificationWorker: { status: 'up', state: 'starting' } },
    });
  });

  it('should answer 503 with the reason when the worker failed or stopped', async () => {
    const controller = await controllerWith('stopped');
    const down = {
      status: 'down',
      state: 'stopped',
      message: 'Temporal worker is not running; no email, push, SMS or WhatsApp is delivered',
    };

    const error = await controller.check().then(
      () => null,
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(error instanceof ServiceUnavailableException && error.getResponse()).toEqual({
      status: 'error',
      info: {},
      error: { notificationWorker: down },
      details: { notificationWorker: down },
    });
  });
});
