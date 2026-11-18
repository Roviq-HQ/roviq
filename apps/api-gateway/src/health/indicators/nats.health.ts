import type { NatsConnection } from '@nats-io/nats-core';
import { Inject, Injectable } from '@nestjs/common';
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { DLQ_NATS_CONNECTION } from '../../dlq/dlq-nats.provider';
import { type ProbeResult, runProbe } from './probe';

@Injectable()
export class NatsHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(DLQ_NATS_CONNECTION) private readonly nc: NatsConnection,
  ) {}

  probe(): Promise<ProbeResult> {
    return runProbe(async () => {
      await this.nc.rtt();
    });
  }

  async isHealthy(): Promise<HealthIndicatorResult<'nats'>> {
    const indicator = this.healthIndicatorService.check('nats');
    const result = await this.probe();
    return result.up
      ? indicator.up({ responseMs: result.responseMs })
      : indicator.down({ message: result.error });
  }
}
