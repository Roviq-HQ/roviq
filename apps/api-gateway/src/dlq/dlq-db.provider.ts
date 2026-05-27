import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pg from 'pg';

// Cross-tenant writes (messages from any tenant) → superuser pool, like audit.
export const DLQ_DB_POOL = Symbol('DLQ_DB_POOL');

export const dlqDbProvider: Provider = {
  provide: DLQ_DB_POOL,
  inject: [ConfigService],
  useFactory: (config: ConfigService): pg.Pool =>
    new pg.Pool({ connectionString: config.getOrThrow<string>('DATABASE_URL_AUDIT'), max: 3 }),
};
