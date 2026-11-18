import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { PROBE_TIMEOUT_MS, type ProbeResult, runProbe } from './probe';

@Injectable()
export class MinioHealthIndicator {
  private readonly liveUrl: string | null;

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    config: ConfigService,
  ) {
    const endpoint = config.get<string>('S3_ENDPOINT');
    this.liveUrl = endpoint ? new URL('/minio/health/live', endpoint).toString() : null;
  }

  probe(): Promise<ProbeResult> {
    return runProbe(async () => {
      if (!this.liveUrl) throw new Error('S3_ENDPOINT is not configured');
      const res = await fetch(this.liveUrl, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`MinIO liveness returned HTTP ${res.status}`);
    });
  }

  async isHealthy(): Promise<HealthIndicatorResult<'minio'>> {
    const indicator = this.healthIndicatorService.check('minio');
    const result = await this.probe();
    return result.up
      ? indicator.up({ responseMs: result.responseMs })
      : indicator.down({ message: result.error });
  }
}
