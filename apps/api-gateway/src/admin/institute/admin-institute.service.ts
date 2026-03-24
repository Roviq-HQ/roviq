import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ClientProxy } from '@nestjs/microservices';
import { DRIZZLE_DB, type DrizzleDB, institutes, withAdmin } from '@roviq/database';
import { count, eq } from 'drizzle-orm';
import { pubSub } from '../../common/pubsub';
import { InstituteService } from '../../institute/management/institute.service';

@Injectable()
export class AdminInstituteService {
  private readonly logger = new Logger(AdminInstituteService.name);

  constructor(
    private readonly instituteService: InstituteService,
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDB,
    @Inject('JETSTREAM_CLIENT') private readonly natsClient: ClientProxy,
  ) {}

  private emitEvent(pattern: string, data: Record<string, unknown>) {
    this.natsClient.emit(pattern, data).subscribe({
      error: (err) => this.logger.warn(`Failed to emit ${pattern}`, err),
    });
    // Publish to GraphQL PubSub for subscriptions
    const key = pattern
      .split('.')
      .map((p, i) =>
        i === 0 ? p.toLowerCase() : p.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
      )
      .join('');
    pubSub.publish(pattern, { [key]: data });
  }

  async approve(id: string) {
    // Validate current status
    const institute = await this.findOrThrow(id);
    if (institute.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(
        `Cannot approve: status is ${institute.status}, must be PENDING_APPROVAL`,
      );
    }

    const record = await withAdmin(this.db, async (tx) => {
      const rows = await tx
        .update(institutes)
        .set({ status: 'PENDING' })
        .where(eq(institutes.id, id))
        .returning();
      return rows[0];
    });

    // TODO: Trigger Temporal InstituteSetupWorkflow
    this.emitEvent('INSTITUTE.approved', { instituteId: id, scope: 'platform' });

    return record;
  }

  async reject(id: string, reason: string) {
    const institute = await this.findOrThrow(id);
    if (!['PENDING_APPROVAL', 'PENDING'].includes(institute.status)) {
      throw new BadRequestException(`Cannot reject: status is ${institute.status}`);
    }

    const record = await withAdmin(this.db, async (tx) => {
      const rows = await tx
        .update(institutes)
        .set({ status: 'REJECTED', settings: { rejectionReason: reason } })
        .where(eq(institutes.id, id))
        .returning();
      return rows[0];
    });

    this.emitEvent('INSTITUTE.rejected', { instituteId: id, reason, scope: 'platform' });

    return record;
  }

  async getStatistics() {
    return withAdmin(this.db, async (tx) => {
      const total = await tx.select({ value: count() }).from(institutes);
      return { totalInstitutes: total[0]?.value ?? 0 };
    });
  }

  private async findOrThrow(id: string) {
    const record = await withAdmin(this.db, async (tx) => {
      const rows = await tx.select().from(institutes).where(eq(institutes.id, id));
      return rows[0] ?? null;
    });
    if (!record) throw new NotFoundException(`Institute ${id} not found`);
    return record;
  }
}
