import { Inject, Injectable } from '@nestjs/common';
import { authEvents, DRIZZLE_DB, type DrizzleDB, mkAdminCtx, withAdmin } from '@roviq/database';
import { AuthEventRepository } from './auth-event.repository';
import type { NewAuthEventRecord } from './types';

@Injectable()
export class AuthEventDrizzleRepository extends AuthEventRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async insert(record: NewAuthEventRecord): Promise<void> {
    await withAdmin(this.db, mkAdminCtx('consumer:auth-event.service'), async (tx) => {
      await tx.insert(authEvents).values(record);
    });
  }
}
