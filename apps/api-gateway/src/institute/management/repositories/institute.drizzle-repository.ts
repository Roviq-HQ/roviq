import { Inject, Injectable } from '@nestjs/common';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  escapeLikePattern,
  type InstituteStatus,
  i18nNameSearch,
  instituteAffiliations,
  instituteAffiliationsLive,
  institutes,
  institutesLive,
  mkAdminCtx,
  mkResellerCtx,
  softDelete,
  uniqueViolationConstraint,
  withAdmin,
  withReseller,
} from '@roviq/database';
import { REDIS_CLIENT } from '@roviq/redis';
import { getRequestContext } from '@roviq/request-context';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type Redis from 'ioredis';
import { recordInstituteAccess } from '../../../auth/institute-access-cache';
import { decodeCursor } from '../../../common/pagination/relay-pagination.model';
import { InstituteRepository } from './institute.repository';
import { instituteColumns, instituteLiveColumns } from './institute-columns';
import type {
  CreateInstituteData,
  DeletedInstituteRecord,
  InstituteRecord,
  InstituteSearchParams,
  InstituteStatistics,
  UpdateInstituteOwnershipData,
} from './types';

// ── Helper functions to reduce cognitive complexity of search() ──

function buildStatusCondition(
  statuses: InstituteSearchParams['statuses'],
  status: InstituteSearchParams['status'],
): SQL | null {
  if (statuses && statuses.length > 0) {
    return inArray(
      institutesLive.status,
      statuses as ('ACTIVE' | 'PENDING' | 'INACTIVE' | 'SUSPENDED' | 'REJECTED')[],
    );
  }
  if (status) {
    return eq(
      institutesLive.status,
      status as 'ACTIVE' | 'PENDING' | 'INACTIVE' | 'SUSPENDED' | 'REJECTED',
    );
  }
  return null;
}

function buildSearchCondition(search: string | undefined): SQL | null {
  if (!search?.trim()) return null;
  return (
    or(
      i18nNameSearch(institutesLive.name, search),
      ilike(institutesLive.code, `%${escapeLikePattern(search.trim())}%`),
    ) ?? null
  );
}

function buildCursorCondition(after: string | undefined): SQL | null {
  if (!after) return null;
  const cursor = decodeCursor(after);
  if (!cursor.id) return null;
  return sql`${institutesLive.id} > ${cursor.id as string}`;
}

// SECURITY: the platform's and the reseller's institute queries. Most run as admin (no RLS):
// reseller scope must use the *ByReseller methods or prove ownership first (ROV-290). An
// institute's own row is read and written by OwnInstituteRepository, under its own role.
@Injectable()
export class InstituteDrizzleRepository extends InstituteRepository {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDB,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    super();
  }

  async search(
    params: InstituteSearchParams,
  ): Promise<{ records: InstituteRecord[]; total: number }> {
    const {
      search,
      status,
      statuses,
      type,
      resellerId,
      groupId,
      state,
      district,
      affiliationBoard,
      createdAfter,
      createdBefore,
      first = 20,
      after,
    } = params;

    return withAdmin(this.db, mkAdminCtx('repository:institute'), async (tx) => {
      const conditions: SQL[] = [];

      const statusCond = buildStatusCondition(statuses, status);
      if (statusCond) conditions.push(statusCond);

      if (type) conditions.push(eq(institutesLive.type, type as 'SCHOOL' | 'COACHING' | 'LIBRARY'));
      if (resellerId) conditions.push(eq(institutesLive.resellerId, resellerId));
      if (groupId) conditions.push(eq(institutesLive.groupId, groupId));

      if (state) {
        conditions.push(sql`LOWER(${institutesLive.address}->>'state') = LOWER(${state})`);
      }
      if (district) {
        conditions.push(sql`LOWER(${institutesLive.address}->>'district') = LOWER(${district})`);
      }
      if (createdAfter) {
        conditions.push(sql`${institutesLive.createdAt} >= ${createdAfter.toISOString()}`);
      }
      if (createdBefore) {
        conditions.push(sql`${institutesLive.createdAt} <= ${createdBefore.toISOString()}`);
      }
      if (affiliationBoard) {
        conditions.push(
          sql`EXISTS (SELECT 1 FROM ${instituteAffiliationsLive}
               WHERE ${instituteAffiliationsLive.tenantId} = ${institutesLive.id}
               AND LOWER(${instituteAffiliationsLive.board}) = LOWER(${affiliationBoard}))`,
        );
      }

      const searchCond = buildSearchCondition(search);
      if (searchCond) conditions.push(searchCond);

      const cursorCond = buildCursorCondition(after);
      if (cursorCond) conditions.push(cursorCond);

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [totalResult, records] = await Promise.all([
        tx.select({ value: count() }).from(institutesLive).where(where),
        tx
          .select(instituteLiveColumns)
          .from(institutesLive)
          .where(where)
          .orderBy(asc(institutesLive.createdAt))
          .limit(first),
      ]);

      return {
        records: records as InstituteRecord[],
        total: totalResult[0]?.value ?? 0,
      };
    });
  }

  async searchByName(query: string): Promise<InstituteRecord[]> {
    return (await this.search({ search: query })).records;
  }

  async findById(id: string): Promise<InstituteRecord | null> {
    // `institutes_live` view excludes soft-deleted rows, so a plain id match is
    // sufficient — withAdmin's RLS bypass would otherwise see trashed rows.
    return withAdmin(this.db, mkAdminCtx('repository:institute'), async (tx) => {
      const rows = await tx
        .select(instituteLiveColumns)
        .from(institutesLive)
        .where(eq(institutesLive.id, id));
      return (rows[0] as InstituteRecord | undefined) ?? null;
    });
  }

  async create(data: CreateInstituteData): Promise<InstituteRecord> {
    const { userId } = getRequestContext();

    try {
      return await withAdmin(this.db, mkAdminCtx('repository:institute'), async (tx) => {
        const rows = await tx
          .insert(institutes)
          .values({
            name: data.name,
            slug: data.slug,
            code: data.code,
            type: data.type as 'SCHOOL' | 'COACHING' | 'LIBRARY' | undefined,
            structureFramework: data.structureFramework as 'NEP' | 'TRADITIONAL' | undefined,
            contact: data.contact ?? { phones: [], emails: [] },
            address: data.address,
            ...(data.departments && {
              departments: data.departments as (
                | 'PRE_PRIMARY'
                | 'PRIMARY'
                | 'UPPER_PRIMARY'
                | 'SECONDARY'
                | 'SENIOR_SECONDARY'
              )[],
            }),
            ...(data.resellerId && { resellerId: data.resellerId }),
            ...(data.groupId && { groupId: data.groupId }),
            ...(data.isDemo !== undefined && { isDemo: data.isDemo }),
            firstAdminUserId: data.firstAdminUserId,
            status: 'PENDING',
            setupStatus: 'PENDING',
            createdBy: userId,
            updatedBy: userId,
          })
          .returning(instituteColumns);
        const record = rows[0] as InstituteRecord;

        if (data.board) {
          // Status, number and dates stay unset until the institute enters its affiliation details.
          await tx
            .insert(instituteAffiliations)
            .values({
              tenantId: record.id,
              board: data.board,
              createdBy: userId,
              updatedBy: userId,
            })
            .onConflictDoNothing({
              target: [instituteAffiliations.tenantId, instituteAffiliations.board],
              where: sql`${instituteAffiliations.deletedAt} IS NULL`,
            });
        }

        return record;
      });
    } catch (err) {
      // The unique indexes are the only race-free duplicate check; name the field for the caller.
      const constraint = uniqueViolationConstraint(err);
      if (constraint === 'institutes_slug_key') {
        throw new BusinessException(
          ErrorCode.SLUG_DUPLICATE,
          `Slug "${data.slug}" is already taken`,
        );
      }
      if (constraint === 'institutes_code_key') {
        throw new BusinessException(
          ErrorCode.INSTITUTE_CODE_DUPLICATE,
          `Institute code "${data.code}" is already taken`,
        );
      }
      throw err;
    }
  }

  async updateStatus(id: string, status: InstituteStatus): Promise<InstituteRecord> {
    const { userId } = getRequestContext();

    const record = await withAdmin(this.db, mkAdminCtx('repository:institute'), async (tx) => {
      const rows = await tx
        .update(institutes)
        .set({
          status,
          updatedBy: userId,
        })
        .where(and(eq(institutes.id, id), isNull(institutes.deletedAt)))
        .returning(instituteColumns);

      if (rows.length === 0) {
        throw new BusinessException(ErrorCode.INSTITUTE_NOT_FOUND, `Institute ${id} not found`);
      }
      return rows[0] as InstituteRecord;
    });
    // After the commit: members' open sessions follow the new status on their next request.
    await recordInstituteAccess(this.redis, id, status);
    return record;
  }

  async updateOwnership(id: string, data: UpdateInstituteOwnershipData): Promise<InstituteRecord> {
    const { userId } = getRequestContext();

    if (data.resellerId === undefined && data.groupId === undefined) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'updateOwnership requires at least one of resellerId or groupId',
      );
    }

    return withAdmin(this.db, mkAdminCtx('repository:institute'), async (tx) => {
      const patch: Record<string, unknown> = { updatedBy: userId };
      if (data.resellerId !== undefined) patch.resellerId = data.resellerId;
      if (data.groupId !== undefined) patch.groupId = data.groupId;

      const rows = await tx
        .update(institutes)
        .set(patch)
        .where(and(eq(institutes.id, id), isNull(institutes.deletedAt)))
        .returning(instituteColumns);

      if (rows.length === 0) {
        throw new BusinessException(ErrorCode.INSTITUTE_NOT_FOUND, `Institute ${id} not found`);
      }
      return rows[0] as InstituteRecord;
    });
  }

  async findByIdIncludeDeleted(id: string): Promise<InstituteRecord | null> {
    return withAdmin(this.db, mkAdminCtx('repository:institute'), async (tx) => {
      const rows = await tx
        .select(instituteColumns)
        .from(institutes) // allow-base-read: trash/restore admin endpoint must see soft-deleted rows
        .where(eq(institutes.id, id));
      return (rows[0] as InstituteRecord | undefined) ?? null;
    });
  }

  async softDelete(id: string): Promise<void> {
    await withAdmin(this.db, mkAdminCtx('repository:institute'), async (tx) => {
      await softDelete(tx, institutes, id);
    });
    await recordInstituteAccess(this.redis, id, 'INACTIVE');
  }

  async restore(id: string): Promise<InstituteRecord> {
    const { userId } = getRequestContext();

    const restored = await withAdmin(this.db, mkAdminCtx('repository:institute'), async (tx) => {
      const rows = await tx
        .update(institutes)
        .set({ deletedAt: null, deletedBy: null, updatedBy: userId })
        .where(and(eq(institutes.id, id), isNotNull(institutes.deletedAt)))
        .returning(instituteColumns);

      if (rows.length === 0) {
        throw new BusinessException(
          ErrorCode.INSTITUTE_NOT_FOUND,
          `Institute ${id} not found or not deleted`,
        );
      }
      return rows[0] as InstituteRecord;
    });
    // The delete marked the institute blocked; its members get in again per its own status.
    await recordInstituteAccess(this.redis, id, restored.status);
    return restored;
  }

  listDeleted(): Promise<DeletedInstituteRecord[]> {
    return withAdmin(this.db, mkAdminCtx('repository:institute'), (tx) =>
      tx
        .select({
          id: institutes.id,
          name: institutes.name,
          code: institutes.code,
          slug: institutes.slug,
          status: institutes.status,
          deletedAt: institutes.deletedAt,
        })
        .from(institutes) // allow-base-read: the recycle bin lists soft-deleted institutes
        .where(isNotNull(institutes.deletedAt))
        .orderBy(desc(institutes.deletedAt))
        .limit(200),
    ).then((rows) =>
      rows.flatMap((row) => (row.deletedAt ? [{ ...row, deletedAt: row.deletedAt }] : [])),
    );
  }

  // ── Reseller-scoped methods ──────────────────────────

  async searchByReseller(
    resellerId: string,
    params: InstituteSearchParams,
  ): Promise<{ records: InstituteRecord[]; total: number }> {
    return withReseller(this.db, mkResellerCtx(resellerId, 'repository:institute'), async (tx) => {
      const conditions: SQL[] = [];

      if (params.search) {
        const pattern = `%${params.search}%`;
        const searchCondition = or(
          sql`${institutesLive.name}->>'en' ILIKE ${pattern}`,
          ilike(institutesLive.code, pattern),
        );
        if (searchCondition) conditions.push(searchCondition);
      }
      if (params.status) {
        conditions.push(sql`${institutesLive.status} = ${params.status}`);
      }
      if (params.type) {
        conditions.push(sql`${institutesLive.type} = ${params.type}`);
      }
      if (params.after) {
        const cursor = decodeCursor(params.after);
        if (cursor.id) conditions.push(sql`${institutesLive.id} > ${cursor.id as string}`);
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const limit = params.first ?? 20;

      const [totalResult, records] = await Promise.all([
        tx.select({ value: count() }).from(institutesLive).where(where),
        tx
          .select(instituteLiveColumns)
          .from(institutesLive)
          .where(where)
          .orderBy(asc(institutesLive.createdAt))
          .limit(limit),
      ]);

      return {
        records: records as InstituteRecord[],
        total: totalResult[0]?.value ?? 0,
      };
    });
  }

  async findByReseller(resellerId: string, id: string): Promise<InstituteRecord | null> {
    return withReseller(this.db, mkResellerCtx(resellerId, 'repository:institute'), async (tx) => {
      const rows = await tx
        .select(instituteLiveColumns)
        .from(institutesLive)
        .where(eq(institutesLive.id, id));
      return (rows[0] as InstituteRecord | undefined) ?? null;
    });
  }

  async statistics(): Promise<InstituteStatistics> {
    return withAdmin(this.db, mkAdminCtx('repository:institute'), async (tx) => {
      const totalResult = await tx.select({ value: count() }).from(institutesLive);

      const byStatus = await tx
        .select({ status: institutesLive.status, count: count() })
        .from(institutesLive)
        .groupBy(institutesLive.status);

      const byType = await tx
        .select({ type: institutesLive.type, count: count() })
        .from(institutesLive)
        .groupBy(institutesLive.type);

      const byReseller = await tx
        .select({ resellerId: institutesLive.resellerId, count: count() })
        .from(institutesLive)
        .groupBy(institutesLive.resellerId);

      const recentResult = await tx
        .select({ value: count() })
        .from(institutesLive)
        .where(sql`${institutesLive.createdAt} > now() - interval '30 days'`);

      return {
        totalInstitutes: totalResult[0]?.value ?? 0,
        byStatus: byStatus.map((r) => ({ key: r.status, count: r.count })),
        byType: byType.map((r) => ({ key: r.type, count: r.count })),
        byReseller: byReseller.map((r) => ({ resellerId: r.resellerId, count: r.count })),
        recentlyCreated: recentResult[0]?.value ?? 0,
      };
    });
  }

  async statisticsByReseller(
    resellerId: string,
  ): Promise<{ totalInstitutes: number; byStatus: Array<{ key: string; count: number }> }> {
    return withReseller(this.db, mkResellerCtx(resellerId, 'repository:institute'), async (tx) => {
      const totalResult = await tx.select({ value: count() }).from(institutesLive);

      const byStatus = await tx
        .select({ status: institutesLive.status, count: count() })
        .from(institutesLive)
        .groupBy(institutesLive.status);

      return {
        totalInstitutes: totalResult[0]?.value ?? 0,
        byStatus: byStatus.map((r) => ({ key: r.status, count: r.count })),
      };
    });
  }
}
