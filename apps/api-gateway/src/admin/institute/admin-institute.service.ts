import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ClientProxy } from '@nestjs/microservices';
import { BusinessException, ErrorCode, getRequestContext } from '@roviq/common-types';
import { DRIZZLE_DB, type DrizzleDB, institutes, withAdmin } from '@roviq/database';
import { Client, Connection } from '@temporalio/client';
import { and, asc, count, eq, ilike, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import { decodeCursor, encodeCursor } from '../../common/pagination/relay-pagination.model';
import { pubSub } from '../../common/pubsub';
import { InstituteService } from '../../institute/management/institute.service';
import type { AdminListInstitutesFilterInput } from './dto/admin-list-institutes-filter.input';

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

  async list(filter: AdminListInstitutesFilterInput) {
    return withAdmin(this.db, async (tx) => {
      const conditions: SQL[] = [isNull(institutes.deletedAt)];

      if (filter.search) {
        const searchTerm = filter.search.trim();
        // Use pg_trgm similarity for typeahead (benefits from GIN trgm index)
        // Falls back to ILIKE for short queries
        if (searchTerm.length >= 3) {
          const tsQuery = searchTerm
            .split(/\s+/)
            .map((w) => `${w}:*`)
            .join(' & ');
          const searchCondition = or(
            sql`to_tsvector('english', COALESCE(${institutes.name}->>'en', '')) @@ to_tsquery('english', ${tsQuery})`,
            sql`COALESCE(${institutes.name}->>'en', '') % ${searchTerm}`,
            sql`COALESCE(${institutes.code}, '') % ${searchTerm}`,
          );
          if (searchCondition) conditions.push(searchCondition);
        } else {
          const pattern = `%${searchTerm}%`;
          const searchCondition = or(
            sql`${institutes.name}->>'en' ILIKE ${pattern}`,
            ilike(institutes.code, pattern),
          );
          if (searchCondition) conditions.push(searchCondition);
        }
      }

      if (filter.status && filter.status.length > 0) {
        conditions.push(inArray(institutes.status, filter.status));
      }
      if (filter.type) {
        conditions.push(eq(institutes.type, filter.type));
      }
      if (filter.resellerId) {
        conditions.push(eq(institutes.resellerId, filter.resellerId));
      }
      if (filter.groupId) {
        conditions.push(eq(institutes.groupId, filter.groupId));
      }

      // Cursor pagination
      if (filter.after) {
        const cursor = decodeCursor(filter.after);
        if (cursor.id) {
          conditions.push(sql`${institutes.id} > ${cursor.id as string}`);
        }
      }

      const where = and(...conditions);
      const limit = filter.first ?? 20;

      const [totalResult, records] = await Promise.all([
        tx.select({ value: count() }).from(institutes).where(where),
        tx
          .select()
          .from(institutes)
          .where(where)
          .orderBy(asc(institutes.createdAt))
          .limit(limit + 1),
      ]);

      const hasNextPage = records.length > limit;
      const nodes = hasNextPage ? records.slice(0, limit) : records;

      const edges = nodes.map((record) => ({
        node: record,
        cursor: encodeCursor({ id: record.id }),
      }));

      return {
        edges,
        pageInfo: {
          hasNextPage,
          hasPreviousPage: !!filter.after,
          startCursor: edges[0]?.cursor,
          endCursor: edges[edges.length - 1]?.cursor,
        },
        totalCount: totalResult[0]?.value ?? 0,
      };
    });
  }

  async approve(id: string) {
    const institute = await this.findOrThrow(id);
    if (institute.status !== 'PENDING_APPROVAL') {
      throw new BusinessException(
        ErrorCode.SETUP_NOT_COMPLETE,
        `Cannot approve: status is ${institute.status}, must be PENDING_APPROVAL`,
      );
    }

    const { userId } = getRequestContext();
    const record = await withAdmin(this.db, async (tx) => {
      const rows = await tx
        .update(institutes)
        .set({ status: 'PENDING', updatedBy: userId })
        .where(eq(institutes.id, id))
        .returning();
      return rows[0];
    });

    this.triggerSetupWorkflow(id, record);
    this.emitEvent('INSTITUTE.approved', {
      instituteId: id,
      resellerId: institute.resellerId,
      scope: 'platform',
    });
    // Notify reseller staff via event (reseller subscription picks this up)
    this.emitEvent('INSTITUTE.status_changed', {
      instituteId: id,
      resellerId: institute.resellerId,
      previousStatus: 'PENDING_APPROVAL',
      newStatus: 'PENDING',
    });

    return record;
  }

  async reject(id: string, reason: string) {
    const institute = await this.findOrThrow(id);
    if (!['PENDING_APPROVAL', 'PENDING'].includes(institute.status)) {
      throw new BusinessException(
        ErrorCode.SETUP_NOT_COMPLETE,
        `Cannot reject: status is ${institute.status}, must be PENDING_APPROVAL or PENDING`,
      );
    }

    const { userId } = getRequestContext();
    const previousStatus = institute.status;
    const record = await withAdmin(this.db, async (tx) => {
      const rows = await tx
        .update(institutes)
        .set({ status: 'REJECTED', settings: { rejectionReason: reason }, updatedBy: userId })
        .where(eq(institutes.id, id))
        .returning();
      return rows[0];
    });

    this.emitEvent('INSTITUTE.rejected', {
      instituteId: id,
      resellerId: institute.resellerId,
      reason,
      scope: 'platform',
    });
    // Notify reseller staff via status change event
    this.emitEvent('INSTITUTE.status_changed', {
      instituteId: id,
      resellerId: institute.resellerId,
      previousStatus,
      newStatus: 'REJECTED',
    });

    return record;
  }

  async getStatistics() {
    return withAdmin(this.db, async (tx) => {
      // Total count (excluding soft-deleted)
      const totalResult = await tx
        .select({ value: count() })
        .from(institutes)
        .where(isNull(institutes.deletedAt));
      const totalInstitutes = totalResult[0]?.value ?? 0;

      // Breakdown by status
      const byStatus = await tx
        .select({ status: institutes.status, count: count() })
        .from(institutes)
        .where(isNull(institutes.deletedAt))
        .groupBy(institutes.status);

      // Breakdown by type
      const byType = await tx
        .select({ type: institutes.type, count: count() })
        .from(institutes)
        .where(isNull(institutes.deletedAt))
        .groupBy(institutes.type);

      // Breakdown by reseller
      const byReseller = await tx
        .select({ resellerId: institutes.resellerId, count: count() })
        .from(institutes)
        .where(isNull(institutes.deletedAt))
        .groupBy(institutes.resellerId);

      // Recent activity: institutes created in last 30 days
      const recentResult = await tx
        .select({ value: count() })
        .from(institutes)
        .where(sql`${institutes.createdAt} > now() - interval '30 days'`);

      return {
        totalInstitutes,
        byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.count])),
        byType: Object.fromEntries(byType.map((r) => [r.type, r.count])),
        byReseller: byReseller.map((r) => ({ resellerId: r.resellerId, count: r.count })),
        recentlyCreated: recentResult[0]?.value ?? 0,
      };
    });
  }

  private async triggerSetupWorkflow(instituteId: string, institute: Record<string, unknown>) {
    try {
      const connection = await Connection.connect({
        address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
      });
      const client = new Client({ connection });
      const { userId } = getRequestContext();

      await client.workflow.start('InstituteSetupWorkflow', {
        taskQueue: 'institute-setup',
        workflowId: `institute-setup-${instituteId}`,
        args: [
          {
            instituteId,
            type: institute.type,
            departments: (institute.departments as string[]) ?? [],
            board: undefined,
            isDemo: (institute.isDemo as boolean) ?? false,
            sessionInfo: {},
            creatingUserId: userId,
          },
        ],
      });

      await connection.close();
      this.logger.log(`Temporal workflow started for institute ${instituteId}`);
    } catch (err) {
      // Don't fail the approve/create operation if Temporal is unavailable
      this.logger.warn(`Failed to trigger Temporal workflow for ${instituteId}: ${err}`);
    }
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
