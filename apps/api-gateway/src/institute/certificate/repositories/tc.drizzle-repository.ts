import { Inject, Injectable } from '@nestjs/common';
import {
  AcademicStatus,
  BusinessException,
  ErrorCode,
  type InstituteContext,
  TC_STATE_MACHINE,
  TcStatus,
} from '@roviq/common-types';
import {
  academicYearsLive,
  DRIZZLE_DB,
  type DrizzleDB,
  instituteAffiliationsLive,
  instituteBrandingLive,
  institutesLive,
  standardsLive,
  studentAcademicsLive,
  studentProfiles,
  studentProfilesLive,
  tcRegister,
  tcRegisterLive,
  tenantUserProfilesLive,
  withTenant,
} from '@roviq/database';
import { and, asc, count, desc, eq, isNull, type SQL, sql } from 'drizzle-orm';
import { markFilesReady } from '../../../files/file-attachment';
import { nextTcSerialNumber } from '../tc-serial';
import { TcRepository } from './tc.repository';
import type {
  CreateDuplicateTcData,
  CreateTcRequestData,
  InstituteLetterheadRow,
  IssueTcData,
  StudentStatusRow,
  TcDetailsRow,
  TcListFilter,
  TcRow,
} from './tc.types';

const rowColumns = {
  id: tcRegisterLive.id,
  studentProfileId: tcRegisterLive.studentProfileId,
  academicYearId: tcRegisterLive.academicYearId,
  tcSerialNumber: tcRegisterLive.tcSerialNumber,
  status: tcRegisterLive.status,
  isDuplicate: tcRegisterLive.isDuplicate,
  originalTcId: tcRegisterLive.originalTcId,
  tcData: tcRegisterLive.tcData,
  pdfFileId: tcRegisterLive.pdfFileId,
} as const;

const detailsColumns = {
  id: tcRegisterLive.id,
  studentProfileId: tcRegisterLive.studentProfileId,
  tcSerialNumber: tcRegisterLive.tcSerialNumber,
  academicYearId: tcRegisterLive.academicYearId,
  status: tcRegisterLive.status,
  reason: tcRegisterLive.reason,
  tcData: tcRegisterLive.tcData,
  clearances: tcRegisterLive.clearances,
  pdfFileId: tcRegisterLive.pdfFileId,
  verificationToken: tcRegisterLive.verificationToken,
  issuedAt: tcRegisterLive.issuedAt,
  admissionNumber: studentProfilesLive.admissionNumber,
  isDuplicate: tcRegisterLive.isDuplicate,
  originalTcId: tcRegisterLive.originalTcId,
  isCounterSigned: tcRegisterLive.isCounterSigned,
  createdAt: tcRegisterLive.createdAt,
  studentFirstName: tenantUserProfilesLive.firstName,
  studentLastName: tenantUserProfilesLive.lastName,
  // The student's standard in the TC's academic year
  standardName: standardsLive.name,
} as const;

/** `jsonb_set` keeps the snapshot and adds the issue date to it. */
const withDateOfIssue = (today: string) =>
  sql`jsonb_set(COALESCE(${tcRegister.tcData}, '{}'), '{dateOfIssue}', to_jsonb(${today}::text))`;

@Injectable()
export class TcDrizzleRepository extends TcRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async findStudentStatus(
    ctx: InstituteContext,
    studentProfileId: string,
  ): Promise<StudentStatusRow | null> {
    const [row] = await withTenant(this.db, ctx, (tx) =>
      tx
        .select({ academicStatus: studentProfilesLive.academicStatus })
        .from(studentProfilesLive)
        .where(eq(studentProfilesLive.id, studentProfileId))
        .limit(1),
    );
    return row ?? null;
  }

  async academicYearExists(ctx: InstituteContext, academicYearId: string): Promise<boolean> {
    // Read under the caller's tenant: another institute's year is invisible here.
    const rows = await withTenant(this.db, ctx, (tx) =>
      tx
        .select({ id: academicYearsLive.id })
        .from(academicYearsLive)
        .where(eq(academicYearsLive.id, academicYearId))
        .limit(1),
    );
    return rows.length > 0;
  }

  async createRequest(
    ctx: InstituteContext,
    data: CreateTcRequestData,
  ): Promise<{ id: string } | null> {
    const rows = await withTenant(this.db, ctx, (tx) =>
      tx
        .insert(tcRegister)
        .values({
          tenantId: ctx.tenantId,
          studentProfileId: data.studentProfileId,
          academicYearId: data.academicYearId,
          tcSerialNumber: data.tempSerial,
          status: TcStatus.REQUESTED,
          reason: data.reason,
          requestedBy: data.actorId,
          createdBy: data.actorId,
          updatedBy: data.actorId,
        })
        // uq_tc_register_open_request: a second request in progress inserts nothing.
        .onConflictDoNothing({
          target: [tcRegister.tenantId, tcRegister.studentProfileId],
          where: sql`${tcRegister.isDuplicate} = false AND ${tcRegister.status} NOT IN ('CANCELLED', 'ISSUED') AND ${tcRegister.deletedAt} IS NULL`,
        })
        .returning({ id: tcRegister.id }),
    );
    return rows.at(0) ?? null;
  }

  async createDuplicateRequest(
    ctx: InstituteContext,
    data: CreateDuplicateTcData,
  ): Promise<{ id: string } | null> {
    const { original } = data;
    const rows = await withTenant(this.db, ctx, (tx) =>
      tx
        .insert(tcRegister)
        .values({
          tenantId: ctx.tenantId,
          studentProfileId: original.studentProfileId,
          academicYearId: original.academicYearId,
          tcSerialNumber: data.tempSerial,
          status: TcStatus.DUPLICATE_REQUESTED,
          reason: data.reason,
          requestedBy: data.actorId,
          isDuplicate: true,
          originalTcId: original.id,
          duplicateReason: data.reason,
          duplicateFee: data.duplicateFee,
          tcData: original.tcData,
          createdBy: data.actorId,
          updatedBy: data.actorId,
        })
        // uq_tc_register_open_duplicate: one duplicate request in progress per original.
        .onConflictDoNothing({
          target: tcRegister.originalTcId,
          where: sql`${tcRegister.status} = 'DUPLICATE_REQUESTED' AND ${tcRegister.deletedAt} IS NULL`,
        })
        .returning({ id: tcRegister.id }),
    );
    return rows.at(0) ?? null;
  }

  async findById(ctx: InstituteContext, id: string): Promise<TcRow | null> {
    const [row] = await withTenant(this.db, ctx, (tx) =>
      tx.select(rowColumns).from(tcRegisterLive).where(eq(tcRegisterLive.id, id)).limit(1),
    );
    return row ?? null;
  }

  async approve(ctx: InstituteContext, id: string, actorId: string): Promise<void> {
    await withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .update(tcRegister)
        .set({ status: TcStatus.APPROVED, approvedBy: actorId, approvedAt: new Date() })
        .where(and(eq(tcRegister.id, id), eq(tcRegister.status, TcStatus.GENERATED)))
        .returning({ id: tcRegister.id });
      if (rows.length > 0) return;
      const [current] = await tx
        .select({ status: tcRegisterLive.status })
        .from(tcRegisterLive)
        .where(eq(tcRegisterLive.id, id))
        .limit(1);
      if (!current) throw new BusinessException(ErrorCode.TC_NOT_FOUND, 'TC not found');
      throw new BusinessException(
        ErrorCode.INVALID_STATE_TRANSITION,
        `Only a generated TC can be approved (current: ${current.status})`,
      );
    });
  }

  async cancel(
    ctx: InstituteContext,
    id: string,
    rejection: Record<string, string>,
    actorId: string,
  ): Promise<void> {
    await withTenant(this.db, ctx, async (tx) => {
      const [existing] = await tx
        .select({ status: tcRegisterLive.status })
        .from(tcRegisterLive)
        .where(eq(tcRegisterLive.id, id))
        .limit(1);
      if (!existing) throw new BusinessException(ErrorCode.TC_NOT_FOUND, 'TC not found');

      TC_STATE_MACHINE.assertTransition(existing.status, TcStatus.CANCELLED);

      await tx
        .update(tcRegister)
        .set({
          status: TcStatus.CANCELLED,
          tcData: sql`COALESCE(${tcRegister.tcData}, '{}'::jsonb) || ${JSON.stringify(rejection)}::jsonb`,
          updatedBy: actorId,
        })
        .where(eq(tcRegister.id, id));
    });
  }

  async issueOriginal(ctx: InstituteContext, data: IssueTcData): Promise<string> {
    const { tc, today, verificationToken, actorId } = data;
    // Serial + status in one transaction so a failed issue doesn't burn a number
    return withTenant(this.db, ctx, async (tx) => {
      const serial = await nextTcSerialNumber(tx, ctx.tenantId, tc.academicYearId);
      // Conditional on the status: of two concurrent issues only one matches.
      const rows = await tx
        .update(tcRegister)
        .set({
          status: TcStatus.ISSUED,
          tcSerialNumber: serial,
          issuedAt: new Date(),
          verificationToken,
          tcData: withDateOfIssue(today),
          updatedBy: actorId,
        })
        .where(and(eq(tcRegister.id, tc.id), eq(tcRegister.status, TcStatus.APPROVED)))
        .returning({ id: tcRegister.id });
      if (rows.length === 0) {
        throw new BusinessException(
          ErrorCode.INVALID_STATE_TRANSITION,
          'TC is no longer approved; it was issued or cancelled meanwhile',
        );
      }

      // PRD §5.1 Step 5
      await tx
        .update(studentProfiles)
        .set({
          tcIssued: true,
          tcNumber: serial,
          tcIssuedDate: today,
          dateOfLeaving: today,
          academicStatus: AcademicStatus.TRANSFERRED_OUT,
          updatedBy: actorId,
        })
        .where(eq(studentProfiles.id, tc.studentProfileId));
      return serial;
    });
  }

  async issueDuplicate(ctx: InstituteContext, data: IssueTcData): Promise<string> {
    const { tc, today, verificationToken, actorId } = data;
    const originalTcId = tc.originalTcId;
    if (!originalTcId) {
      throw new BusinessException(ErrorCode.TC_NOT_FOUND, 'Original TC of the duplicate not found');
    }
    return withTenant(this.db, ctx, async (tx) => {
      const [original] = await tx
        .select({ tcSerialNumber: tcRegisterLive.tcSerialNumber })
        .from(tcRegisterLive)
        .where(eq(tcRegisterLive.id, originalTcId))
        .limit(1);
      if (!original) {
        throw new BusinessException(
          ErrorCode.TC_NOT_FOUND,
          'Original TC of the duplicate not found',
        );
      }
      const [{ issued }] = await tx
        .select({ issued: count() })
        .from(tcRegisterLive)
        .where(
          and(
            eq(tcRegisterLive.originalTcId, originalTcId),
            eq(tcRegisterLive.status, TcStatus.DUPLICATE_ISSUED),
          ),
        );
      // uq_tc_serial backs this up if two duplicates of one original race.
      const serial = `${original.tcSerialNumber}-D${issued + 1}`;
      const rows = await tx
        .update(tcRegister)
        .set({
          status: TcStatus.DUPLICATE_ISSUED,
          tcSerialNumber: serial,
          issuedAt: new Date(),
          verificationToken,
          tcData: withDateOfIssue(today),
          updatedBy: actorId,
        })
        .where(and(eq(tcRegister.id, tc.id), eq(tcRegister.status, TcStatus.DUPLICATE_REQUESTED)))
        .returning({ id: tcRegister.id });
      if (rows.length === 0) {
        throw new BusinessException(
          ErrorCode.INVALID_STATE_TRANSITION,
          'Duplicate TC is no longer requested; it was issued or cancelled meanwhile',
        );
      }
      return serial;
    });
  }

  async findLetterhead(ctx: InstituteContext): Promise<InstituteLetterheadRow | null> {
    const [row] = await withTenant(this.db, ctx, (tx) =>
      tx
        .select({
          name: institutesLive.name,
          address: institutesLive.address,
          board: instituteAffiliationsLive.board,
          affiliationNumber: instituteAffiliationsLive.affiliationNumber,
          logoFileId: instituteBrandingLive.logoFileId,
        })
        .from(institutesLive)
        .leftJoin(instituteBrandingLive, eq(instituteBrandingLive.tenantId, institutesLive.id))
        .leftJoin(
          instituteAffiliationsLive,
          eq(instituteAffiliationsLive.tenantId, institutesLive.id),
        )
        .where(eq(institutesLive.id, ctx.tenantId))
        // Same primary-affiliation order as institute setup: dated rows first, oldest first.
        .orderBy(
          sql`${instituteAffiliationsLive.validFrom} ASC NULLS LAST`,
          asc(instituteAffiliationsLive.createdAt),
        )
        .limit(1),
    );
    return row ?? null;
  }

  attachPdf(
    ctx: InstituteContext,
    data: { tcId: string; fileId: string; actorId: string },
  ): Promise<boolean> {
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .update(tcRegister)
        .set({ pdfFileId: data.fileId, updatedBy: data.actorId })
        .where(and(eq(tcRegister.id, data.tcId), isNull(tcRegister.pdfFileId)))
        .returning({ id: tcRegister.id });
      if (rows.length === 0) return false;
      await markFilesReady(tx, { fileIds: [data.fileId], purpose: 'TC_PDF', userId: data.actorId });
      return true;
    });
  }

  async findDetails(ctx: InstituteContext, id: string): Promise<TcDetailsRow | null> {
    const [row] = await this.selectDetails(ctx, eq(tcRegisterLive.id, id), 1);
    return row ?? null;
  }

  list(ctx: InstituteContext, filter: TcListFilter): Promise<TcDetailsRow[]> {
    const conditions: SQL[] = [];
    if (filter.status) conditions.push(eq(tcRegisterLive.status, filter.status));
    if (filter.studentProfileId)
      conditions.push(eq(tcRegisterLive.studentProfileId, filter.studentProfileId));
    if (filter.originalTcId) conditions.push(eq(tcRegisterLive.originalTcId, filter.originalTcId));
    return this.selectDetails(ctx, conditions.length > 0 ? and(...conditions) : undefined, 50);
  }

  private selectDetails(ctx: InstituteContext, where: SQL | undefined, limit: number) {
    return withTenant(this.db, ctx, (tx) =>
      tx
        .select(detailsColumns)
        .from(tcRegisterLive)
        .innerJoin(studentProfilesLive, eq(studentProfilesLive.id, tcRegisterLive.studentProfileId))
        .innerJoin(
          tenantUserProfilesLive,
          and(
            eq(tenantUserProfilesLive.userId, studentProfilesLive.userId),
            eq(tenantUserProfilesLive.tenantId, studentProfilesLive.tenantId),
          ),
        )
        .leftJoin(
          studentAcademicsLive,
          and(
            eq(studentAcademicsLive.studentProfileId, tcRegisterLive.studentProfileId),
            eq(studentAcademicsLive.academicYearId, tcRegisterLive.academicYearId),
          ),
        )
        .leftJoin(standardsLive, eq(standardsLive.id, studentAcademicsLive.standardId))
        .where(where)
        .orderBy(desc(tcRegisterLive.createdAt))
        .limit(limit),
    );
  }
}
