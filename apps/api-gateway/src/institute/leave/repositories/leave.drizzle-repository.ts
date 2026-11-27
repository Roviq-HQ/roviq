import { Inject, Injectable } from '@nestjs/common';
import {
  type AppAbility,
  type AppAction,
  BusinessException,
  ErrorCode,
  type LeaveStatus,
} from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  filesLive,
  leaveFiles,
  leaveFilesLive,
  leaves,
  leavesLive,
  memberships,
  membershipsLive,
  mkInstituteCtx,
  softDelete,
  studentProfilesLive,
  tenantUserProfilesLive,
  withTenant,
} from '@roviq/database';
import { getRequestContext } from '@roviq/request-context';
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { markFilesDeleted, markFilesReady } from '../../../files/file-attachment';
import { fileLiveColumns } from '../../../files/repositories/file-columns';
import type { FileRecord } from '../../../files/repositories/types';
import { LeaveRepository } from './leave.repository';
import { leaveInScope, mayApplyFor } from './leave-scope';
import type {
  CreateLeaveData,
  LeaveApplicantRecord,
  LeaveListQuery,
  LeaveOnDateQuery,
  LeaveRecord,
  UpdateLeaveData,
} from './types';

// Read projection — `leaves_live` view excludes soft-deleted rows.
const liveColumns = {
  id: leavesLive.id,
  tenantId: leavesLive.tenantId,
  userId: leavesLive.userId,
  startDate: leavesLive.startDate,
  endDate: leavesLive.endDate,
  type: leavesLive.type,
  reason: leavesLive.reason,
  status: leavesLive.status,
  decidedBy: leavesLive.decidedBy,
  createdAt: leavesLive.createdAt,
  updatedAt: leavesLive.updatedAt,
} as const;

const writeReturning = {
  id: leaves.id,
  tenantId: leaves.tenantId,
  userId: leaves.userId,
  startDate: leaves.startDate,
  endDate: leaves.endDate,
  type: leaves.type,
  reason: leaves.reason,
  status: leaves.status,
  decidedBy: leaves.decidedBy,
  createdAt: leaves.createdAt,
  updatedAt: leaves.updatedAt,
} as const;

type LeaveRow = Omit<LeaveRecord, 'files' | 'applicant'>;

const LEAVE_FILE_PURPOSE = 'LEAVE_ATTACHMENT';

async function loadFiles(tx: DrizzleDB, leaveIds: string[]): Promise<Map<string, FileRecord[]>> {
  const byLeave = new Map<string, FileRecord[]>();
  if (leaveIds.length === 0) return byLeave;
  const rows = await tx
    .select({ leaveId: leaveFilesLive.leaveId, ...fileLiveColumns })
    .from(leaveFilesLive)
    .innerJoin(filesLive, eq(filesLive.id, leaveFilesLive.fileId))
    .where(inArray(leaveFilesLive.leaveId, leaveIds))
    .orderBy(asc(leaveFilesLive.id));
  for (const { leaveId, ...file } of rows) {
    const list = byLeave.get(leaveId) ?? [];
    list.push(file);
    byLeave.set(leaveId, list);
  }
  return byLeave;
}

/** Name of each applicant, and the admission number of a student, keyed by membership id. */
async function loadApplicants(
  tx: DrizzleDB,
  membershipIds: string[],
): Promise<Map<string, LeaveApplicantRecord>> {
  const unique = [...new Set(membershipIds)];
  if (unique.length === 0) return new Map();
  const rows = await tx
    .select({
      membershipId: memberships.id,
      firstName: tenantUserProfilesLive.firstName,
      lastName: tenantUserProfilesLive.lastName,
      admissionNumber: studentProfilesLive.admissionNumber,
    })
    .from(memberships) // allow-base-read: a leave keeps the name of a member who has left
    .innerJoin(
      tenantUserProfilesLive,
      and(
        eq(tenantUserProfilesLive.userId, memberships.userId),
        eq(tenantUserProfilesLive.tenantId, memberships.tenantId),
      ),
    )
    .leftJoin(studentProfilesLive, eq(studentProfilesLive.membershipId, memberships.id))
    .where(inArray(memberships.id, unique));
  return new Map(rows.map(({ membershipId, ...applicant }) => [membershipId, applicant]));
}

async function withFiles(tx: DrizzleDB, rows: LeaveRow[]): Promise<LeaveRecord[]> {
  // One after the other: both run on the transaction's single connection.
  const byLeave = await loadFiles(
    tx,
    rows.map((row) => row.id),
  );
  const applicants = await loadApplicants(
    tx,
    rows.map((row) => row.userId),
  );
  return rows.map((row) => ({
    ...row,
    applicant: applicants.get(row.userId) ?? null,
    files: byLeave.get(row.id) ?? [],
  }));
}

async function attachFiles(
  tx: DrizzleDB,
  params: { tenantId: string; userId: string; leaveId: string; fileIds: string[] },
): Promise<void> {
  if (params.fileIds.length === 0) return;
  await markFilesReady(tx, {
    fileIds: params.fileIds,
    purpose: LEAVE_FILE_PURPOSE,
    userId: params.userId,
  });
  await tx.insert(leaveFiles).values(
    params.fileIds.map((fileId) => ({
      tenantId: params.tenantId,
      leaveId: params.leaveId,
      fileId,
      createdBy: params.userId,
      updatedBy: params.userId,
    })),
  );
}

async function detachFiles(
  tx: DrizzleDB,
  params: { userId: string; leaveId: string; fileIds?: string[] },
): Promise<void> {
  const detached = await tx
    .update(leaveFiles)
    .set({ deletedAt: new Date(), deletedBy: params.userId, updatedBy: params.userId })
    .where(
      and(
        eq(leaveFiles.leaveId, params.leaveId),
        isNull(leaveFiles.deletedAt),
        params.fileIds ? inArray(leaveFiles.fileId, params.fileIds) : undefined,
      ),
    )
    .returning({ fileId: leaveFiles.fileId });
  await markFilesDeleted(tx, {
    fileIds: detached.map((row) => row.fileId),
    userId: params.userId,
  });
}

@Injectable()
export class LeaveDrizzleRepository extends LeaveRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  private getTenantId(): string {
    const { tenantId } = getRequestContext();
    if (!tenantId) throw new Error('Tenant context is required');
    return tenantId;
  }

  async findById(id: string, ability: AppAbility): Promise<LeaveRecord | null> {
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:leave'), async (tx) => {
      const rows = await tx
        .select(liveColumns)
        .from(leavesLive)
        .where(and(eq(leavesLive.id, id), leaveInScope(ability, 'read', leavesLive.id)));
      const [record] = await withFiles(tx, rows);
      return record ?? null;
    });
  }

  async list(query: LeaveListQuery, ability: AppAbility): Promise<LeaveRecord[]> {
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:leave'), async (tx) => {
      const conditions = [leaveInScope(ability, 'read', leavesLive.id)];
      if (query.userId) conditions.push(eq(leavesLive.userId, query.userId));
      if (query.status) conditions.push(eq(leavesLive.status, query.status));
      if (query.type) conditions.push(eq(leavesLive.type, query.type));
      // Date-range filter uses overlap semantics:
      //   leave.startDate <= range.endDate AND leave.endDate >= range.startDate
      if (query.endDate) conditions.push(lte(leavesLive.startDate, query.endDate));
      if (query.startDate) conditions.push(gte(leavesLive.endDate, query.startDate));
      const rows = await tx
        .select(liveColumns)
        .from(leavesLive)
        .where(and(...conditions))
        .orderBy(sql`${leavesLive.startDate} DESC`);
      return withFiles(tx, rows);
    });
  }

  async isAllowed(id: string, ability: AppAbility, action: AppAction): Promise<boolean> {
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:leave'), async (tx) => {
      const rows = await tx
        .select({ id: leavesLive.id })
        .from(leavesLive)
        .where(and(eq(leavesLive.id, id), leaveInScope(ability, action, leavesLive.id)));
      return rows.length > 0;
    });
  }

  async canApplyFor(membershipId: string, ability: AppAbility): Promise<boolean> {
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:leave'), async (tx) => {
      const rows = await tx
        .select({ id: membershipsLive.id })
        .from(membershipsLive)
        .where(and(eq(membershipsLive.id, membershipId), mayApplyFor(ability, membershipId)));
      return rows.length > 0;
    });
  }

  async create(data: CreateLeaveData): Promise<LeaveRecord> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:leave'), async (tx) => {
      const rows = await tx
        .insert(leaves)
        .values({
          tenantId,
          userId: data.userId,
          startDate: data.startDate,
          endDate: data.endDate,
          type: data.type,
          reason: data.reason,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning(writeReturning);
      const [row] = rows;
      if (!row) throw new Error('Leave insert returned no row');
      await attachFiles(tx, { tenantId, userId, leaveId: row.id, fileIds: data.fileIds });
      const [record] = await withFiles(tx, [row]);
      if (!record) throw new Error('Leave insert returned no row');
      return record;
    });
  }

  async update(id: string, data: UpdateLeaveData): Promise<LeaveRecord> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:leave'), async (tx) => {
      const rows = await tx
        .update(leaves)
        .set({
          ...(data.startDate !== undefined && { startDate: data.startDate }),
          ...(data.endDate !== undefined && { endDate: data.endDate }),
          ...(data.type !== undefined && { type: data.type }),
          ...(data.reason !== undefined && { reason: data.reason }),
          updatedBy: userId,
        })
        // Only a pending leave is editable; a decision made since the check wins.
        .where(and(eq(leaves.id, id), eq(leaves.status, 'PENDING'), isNull(leaves.deletedAt)))
        .returning(writeReturning);
      if (rows.length === 0)
        throw new BusinessException(ErrorCode.LEAVE_NOT_EDITABLE, `Leave ${id} is not pending`);
      if (data.fileIds !== undefined) {
        const wanted = new Set(data.fileIds);
        const current = (await loadFiles(tx, [id])).get(id) ?? [];
        const currentIds = new Set(current.map((file) => file.id));
        const removed = [...currentIds].filter((fileId) => !wanted.has(fileId));
        const added = [...wanted].filter((fileId) => !currentIds.has(fileId));
        if (removed.length > 0) await detachFiles(tx, { userId, leaveId: id, fileIds: removed });
        await attachFiles(tx, { tenantId, userId, leaveId: id, fileIds: added });
      }
      const [record] = await withFiles(tx, rows);
      if (!record) throw new BusinessException(ErrorCode.LEAVE_NOT_FOUND, `Leave ${id} not found`);
      return record;
    });
  }

  async setStatus(
    id: string,
    from: LeaveStatus,
    status: 'APPROVED' | 'REJECTED' | 'CANCELLED',
    decidedBy: string,
  ): Promise<LeaveRecord> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:leave'), async (tx) => {
      const rows = await tx
        .update(leaves)
        .set({ status, decidedBy, updatedBy: userId, version: sql`${leaves.version} + 1` })
        // The caller was authorised for the leave in status `from`; a decision made meanwhile wins.
        .where(and(eq(leaves.id, id), eq(leaves.status, from), isNull(leaves.deletedAt)))
        .returning(writeReturning);
      const [record] = await withFiles(tx, rows);
      if (!record) {
        throw new BusinessException(
          ErrorCode.INVALID_STATE_TRANSITION,
          `Leave ${id} is no longer ${from}`,
        );
      }
      return record;
    });
  }

  async softDelete(id: string): Promise<void> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    await withTenant(this.db, mkInstituteCtx(tenantId, 'repository:leave'), async (tx) => {
      await softDelete(tx, leaves, id);
      await detachFiles(tx, { userId, leaveId: id });
    });
  }

  async approvedOnDate(query: LeaveOnDateQuery): Promise<string[]> {
    if (query.userIds.length === 0) return [];
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:leave'), async (tx) => {
      const rows = await tx
        .select({ userId: leavesLive.userId })
        .from(leavesLive)
        .where(
          and(
            inArray(leavesLive.userId, query.userIds),
            eq(leavesLive.status, 'APPROVED'),
            lte(leavesLive.startDate, query.date),
            gte(leavesLive.endDate, query.date),
          ),
        );
      return rows.map((r) => r.userId);
    });
  }
}
