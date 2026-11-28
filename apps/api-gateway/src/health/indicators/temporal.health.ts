import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { Connection } from '@temporalio/client';
import { logProbeFailure, PROBE_TIMEOUT_MS, type ProbeResult, runProbe } from './probe';

const SERVING = 1;

@Injectable()
export class TemporalHealthIndicator implements OnApplicationShutdown {
  private readonly connection: Connection | null;

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    config: ConfigService,
  ) {
    const address = config.get<string>('TEMPORAL_ADDRESS');
    // Lazy: the gRPC channel opens on the first check and is reused by every later one.
    // No interceptors: a probe is asked once. The client's default retries on a timer, and a
    // retry left over when the app closes this connection throws where nothing can catch it.
    this.connection = address ? Connection.lazy({ address, interceptors: [] }) : null;
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
    if (result.up) return indicator.up({ responseMs: result.responseMs });
    logProbeFailure('temporal', result);
    return indicator.down();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.connection?.close();
  }
}
