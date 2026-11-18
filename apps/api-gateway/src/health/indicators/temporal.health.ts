import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { Connection } from '@temporalio/client';
import { PROBE_TIMEOUT_MS, type ProbeResult, runProbe } from './probe';

const SERVING = 1;

@Injectable()
export class TemporalHealthIndicator implements OnModuleDestroy {
  private readonly connection: Connection | null;

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    config: ConfigService,
  ) {
    const address = config.get<string>('TEMPORAL_ADDRESS');
    // Lazy: the gRPC channel opens on the first check and is reused by every later one.
    this.connection = address ? Connection.lazy({ address }) : null;
  }

  probe(): Promise<ProbeResult> {
    return runProbe(async () => {
      const connection = this.connection;
      if (!connection) throw new Error('TEMPORAL_ADDRESS is not configured');
      const res = await connection.withDeadline(Date.now() + PROBE_TIMEOUT_MS, () =>
        connection.healthService.check({}),
      );
      if (res.status !== SERVING) throw new Error(`Temporal status ${res.status}`);
    });
  }

  async isHealthy(): Promise<HealthIndicatorResult<'temporal'>> {
    const indicator = this.healthIndicatorService.check('temporal');
    const result = await this.probe();
    return result.up
      ? indicator.up({ responseMs: result.responseMs })
      : indicator.down({ message: result.error });
  }

  async onModuleDestroy(): Promise<void> {
    await this.connection?.close();
  }
}
