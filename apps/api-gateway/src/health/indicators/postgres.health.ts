import { Inject, Injectable } from '@nestjs/common';
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { DRIZZLE_DB, type DrizzleDB } from '@roviq/database';
import { sql } from 'drizzle-orm';
import { type ProbeResult, runProbe } from './probe';

@Injectable()
export class PostgresHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDB,
  ) {}

  probe(): Promise<ProbeResult> {
    return runProbe(async () => {
      await this.db.execute(sql`select 1`);
    });
  }

  async isHealthy(): Promise<HealthIndicatorResult<'postgres'>> {
    const indicator = this.healthIndicatorService.check('postgres');
    const result = await this.probe();
    return result.up
      ? indicator.up({ responseMs: result.responseMs })
      : indicator.down({ message: result.error });
  }
}
