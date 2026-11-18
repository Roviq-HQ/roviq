import { Inject, Injectable } from '@nestjs/common';
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { REDIS_CLIENT } from '@roviq/redis';
import type Redis from 'ioredis';
import { logProbeFailure, type ProbeResult, runProbe } from './probe';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  probe(): Promise<ProbeResult> {
    return runProbe(async () => {
      await this.redis.ping();
    });
  }

  async isHealthy(): Promise<HealthIndicatorResult<'redis'>> {
    const indicator = this.healthIndicatorService.check('redis');
    const result = await this.probe();
    if (result.up) return indicator.up({ responseMs: result.responseMs });
    logProbeFailure('redis', result);
    return indicator.down();
  }
}
