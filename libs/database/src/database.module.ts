import { Global, Module, type OnApplicationShutdown, type Provider } from '@nestjs/common';
import type { Pool } from 'pg';
import { DRIZZLE_POOL, drizzleProviders } from './providers';

const DRIZZLE_POOL_CLOSER = Symbol('DRIZZLE_POOL_CLOSER');

// onApplicationShutdown is the last phase of app.close(): requests, consumers and workers are done.
const poolCloser: Provider = {
  provide: DRIZZLE_POOL_CLOSER,
  inject: [DRIZZLE_POOL],
  useFactory: (pool: Pool): OnApplicationShutdown => ({
    onApplicationShutdown: () => pool.end(),
  }),
};

@Global()
@Module({
  providers: [...drizzleProviders, poolCloser],
  exports: [...drizzleProviders],
})
export class DatabaseModule {}
