import { Logger as NestLogger } from '@nestjs/common';
import type { Logger as DrizzleLogger } from 'drizzle-orm';

export class RoviqDrizzleLogger implements DrizzleLogger {
  private readonly logger = new NestLogger('Drizzle');

  logQuery(query: string, params: unknown[]): void {
    // The statement with its placeholders; the values are never logged.
    this.logger.debug(`${query} -- ${params.length} parameter(s)`);
  }
}
