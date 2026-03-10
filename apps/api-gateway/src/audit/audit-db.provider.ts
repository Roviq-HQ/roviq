import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pg from 'pg';

export const AUDIT_DB_POOL = Symbol('AUDIT_DB_POOL');

export const auditDbProvider: Provider = {
  provide: AUDIT_DB_POOL,
  inject: [ConfigService],
  useFactory: (config: ConfigService): pg.Pool => {
    return new pg.Pool({
      connectionString: config.getOrThrow<string>('DATABASE_URL_ADMIN'),
      max: 5,
    });
  },
};
