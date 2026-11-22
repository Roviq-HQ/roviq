import { Inject, Injectable } from '@nestjs/common';
import {
  BusinessException,
  ErrorCode,
  EXPORT_REPORT_STATE_MACHINE,
  type ExportReportStatus,
} from '@roviq/common-types';
import {
  academicYearsLive,
  DRIZZLE_DB,
  type DrizzleDB,
  exportReports,
  exportReportsLive,
  filesLive,
  instituteAffiliationsLive,
  instituteIdentifiersLive,
  institutesLive,
  SYSTEM_USER_ID,
  tenantUserProfilesLive,
  userProfilesLive,
  withAdmin,
  withTenant,
} from '@roviq/database';
import { and, desc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { markFilesReady } from '../../../files/file-attachment';
import { fileLiveColumns } from '../../../files/repositories/file-columns';
import type { FileRecord } from '../../../files/repositories/types';
import { ExportReportRepository } from './export-report.repository';
import type {
  CompleteExportReportData,
  CreatedExportReport,
  CreateExportReportData,
  ExportAcademicYearRecord,
  ExportInstituteRecord,
  ExportReportCtx,
  ExportReportRecord,
  FailExportReportData,
  TimedOutExport,
} from './types';

const recordColumns = {
  id: exportReportsLive.id,
  tenantId: exportReportsLive.tenantId,
  reportType: exportReportsLive.reportType,
  academicYearId: exportReportsLive.academicYearId,
  academicYearLabel: academicYearsLive.label,
  status: exportReportsLive.status,
  workflowId: exportReportsLive.workflowId,
  fileId: exportReportsLive.fileId,
  rowCount: exportReportsLive.rowCount,
  errorCode: exportReportsLive.errorCode,
  requestedBy: exportReportsLive.requestedBy,
  // A staff member is named as the institute records them; a platform admin by their account.
  requesterFirstName: sql<Record<
    string,
    string
  > | null>`CASE WHEN ${tenantUserProfilesLive.id} IS NOT NULL THEN ${tenantUserProfilesLive.firstName} ELSE ${userProfilesLive.firstName} END`,
  requesterLastName: sql<Record<
    string,
    string
  > | null>`CASE WHEN ${tenantUserProfilesLive.id} IS NOT NULL THEN ${tenantUserProfilesLive.lastName} ELSE ${userProfilesLive.lastName} END`,
  requestedAt: exportReportsLive.requestedAt,
  completedAt: exportReportsLive.completedAt,
  version: exportReportsLive.version,
} as const;

@Injectable()
export class ExportReportDrizzleRepository extends ExportReportRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async create(ctx: ExportReportCtx, data: CreateExportReportData): Promise<CreatedExportReport> {
    return this.run(ctx, async (tx) => {
      const [row] = await tx
        .insert(exportReports)
        .values({
          tenantId: data.tenantId,
          reportType: data.reportType,
          academicYearId: data.academicYearId,
          workflowId: data.workflowId,
          requestedBy: data.requestedBy,
          createdBy: data.requestedBy,
          updatedBy: data.requestedBy,
        })
        .returning({ id: exportReports.id });
      if (!row) throw new Error('export_reports insert returned no row');
      const report = await this.selectById(tx, row.id);
      if (!report) throw new Error(`Export report ${row.id} not readable after insert`);
      const generated = await tx.execute<{ id: string }>(sql`SELECT uuidv7() AS id`);
      const fileId = generated.rows[0]?.id;
      if (!fileId) throw new Error('uuidv7() returned no id');
      return { report, fileId };
    });
  }

  findById(ctx: ExportReportCtx, id: string): Promise<ExportReportRecord | null> {
    return this.run(ctx, (tx) => this.selectById(tx, id));
  }

  listForInstitute(
    ctx: ExportReportCtx,
    tenantId: string,
    limit: number,
  ): Promise<ExportReportRecord[]> {
    return this.run(ctx, (tx) =>
      this.selectRecords(tx)
        .where(eq(exportReportsLive.tenantId, tenantId))
        .orderBy(desc(exportReportsLive.requestedAt), desc(exportReportsLive.id))
        .limit(limit),
    );
  }

  async markRunning(ctx: ExportReportCtx, id: string, userId: string): Promise<void> {
    await this.run(ctx, (tx) =>
      this.transition(tx, { id, from: 'PENDING', to: 'RUNNING', set: { updatedBy: userId } }),
    );
  }

  async markCompleted(ctx: ExportReportCtx, data: CompleteExportReportData): Promise<void> {
    await this.run(ctx, async (tx) => {
      await this.transition(tx, {
        id: data.id,
        from: 'RUNNING',
        to: 'COMPLETED',
        set: {
          fileId: data.fileId,
          rowCount: data.rowCount,
          completedAt: new Date(),
          updatedBy: data.userId,
        },
      });
      await markFilesReady(tx, {
        fileIds: [data.fileId],
        purpose: 'COMPLIANCE_EXPORT',
        userId: data.userId,
        tenantId: data.tenantId,
      });
    });
  }

  async markFailed(ctx: ExportReportCtx, data: FailExportReportData): Promise<void> {
    await this.run(ctx, (tx) =>
      this.transition(tx, {
        id: data.id,
        from: data.from,
        to: 'FAILED',
        set: { errorCode: data.errorCode, completedAt: new Date(), updatedBy: data.userId },
      }),
    );
  }

  findInstitute(ctx: ExportReportCtx, instituteId: string): Promise<ExportInstituteRecord | null> {
    return this.run(ctx, async (tx) => {
      const [institute] = await tx
        .select({
          code: institutesLive.code,
          slug: institutesLive.slug,
          address: institutesLive.address,
        })
        .from(institutesLive)
        .where(eq(institutesLive.id, instituteId));
      if (!institute) return null;
      const affiliations = await tx
        .select({ board: instituteAffiliationsLive.board })
        .from(instituteAffiliationsLive)
        .where(
          and(
            eq(instituteAffiliationsLive.tenantId, instituteId),
            ne(instituteAffiliationsLive.affiliationStatus, 'REVOKED'),
          ),
        );
      const identifiers = await tx
        .select({ type: instituteIdentifiersLive.type })
        .from(instituteIdentifiersLive)
        .where(eq(instituteIdentifiersLive.tenantId, instituteId));
      return {
        code: institute.code,
        slug: institute.slug,
        eligibility: {
          boards: affiliations.map((a) => a.board),
          state: institute.address?.state ?? null,
          identifierTypes: identifiers.map((i) => i.type),
        },
      };
    });
  }

  async failTimedOut(
    ctx: ExportReportCtx,
    tenantId: string,
    requestedBefore: Date,
  ): Promise<TimedOutExport[]> {
    // Both are allowed by the machine; asserted so a change to it is noticed here.
    EXPORT_REPORT_STATE_MACHINE.assertTransition('PENDING', 'FAILED');
    EXPORT_REPORT_STATE_MACHINE.assertTransition('RUNNING', 'FAILED');
    return this.run(ctx, (tx) =>
      tx
        .update(exportReports)
        .set({
          status: 'FAILED',
          errorCode: ErrorCode.EXPORT_TIMED_OUT,
          completedAt: new Date(),
          updatedBy: SYSTEM_USER_ID,
          version: sql`${exportReports.version} + 1`,
        })
        .where(
          and(
            eq(exportReports.tenantId, tenantId),
            inArray(exportReports.status, ['PENDING', 'RUNNING']),
            lt(exportReports.requestedAt, requestedBefore),
            isNull(exportReports.deletedAt),
          ),
        )
        .returning({
          id: exportReports.id,
          tenantId: exportReports.tenantId,
          reportType: exportReports.reportType,
          academicYearId: exportReports.academicYearId,
          requestedBy: exportReports.requestedBy,
        }),
    );
  }

  async academicYearBelongsTo(
    ctx: ExportReportCtx,
    tenantId: string,
    academicYearId: string,
  ): Promise<boolean> {
    const rows = await this.run(ctx, (tx) =>
      tx
        .select({ id: academicYearsLive.id })
        .from(academicYearsLive)
        .where(
          and(eq(academicYearsLive.id, academicYearId), eq(academicYearsLive.tenantId, tenantId)),
        ),
    );
    return rows.length > 0;
  }

  listAcademicYears(ctx: ExportReportCtx, tenantId: string): Promise<ExportAcademicYearRecord[]> {
    return this.run(ctx, (tx) =>
      tx
        .select({
          id: academicYearsLive.id,
          label: academicYearsLive.label,
          startDate: academicYearsLive.startDate,
          endDate: academicYearsLive.endDate,
          isActive: academicYearsLive.isActive,
        })
        .from(academicYearsLive)
        .where(eq(academicYearsLive.tenantId, tenantId))
        .orderBy(desc(academicYearsLive.startDate)),
    );
  }

  async findCompletedExportFile(ctx: ExportReportCtx, fileId: string): Promise<FileRecord | null> {
    return this.run(ctx, async (tx) => {
      const [row] = await tx
        .select(fileLiveColumns)
        .from(exportReportsLive)
        .innerJoin(filesLive, eq(filesLive.id, exportReportsLive.fileId))
        .where(
          and(
            eq(exportReportsLive.fileId, fileId),
            eq(exportReportsLive.status, 'COMPLETED'),
            eq(filesLive.status, 'READY'),
            eq(filesLive.purpose, 'COMPLIANCE_EXPORT'),
          ),
        );
      return (row as FileRecord | undefined) ?? null;
    });
  }

  private run<T>(ctx: ExportReportCtx, fn: (tx: DrizzleDB) => Promise<T>): Promise<T> {
    return ctx.scope === 'platform' ? withAdmin(this.db, ctx, fn) : withTenant(this.db, ctx, fn);
  }

  private selectRecords(tx: DrizzleDB) {
    return tx
      .select(recordColumns)
      .from(exportReportsLive)
      .leftJoin(academicYearsLive, eq(academicYearsLive.id, exportReportsLive.academicYearId))
      .leftJoin(
        tenantUserProfilesLive,
        and(
          eq(tenantUserProfilesLive.userId, exportReportsLive.requestedBy),
          eq(tenantUserProfilesLive.tenantId, exportReportsLive.tenantId),
        ),
      )
      .leftJoin(userProfilesLive, eq(userProfilesLive.userId, exportReportsLive.requestedBy));
  }

  private async selectById(tx: DrizzleDB, id: string): Promise<ExportReportRecord | null> {
    const [row] = await this.selectRecords(tx).where(eq(exportReportsLive.id, id));
    return row ?? null;
  }

  /** Conditional on the prior status, so two writers cannot both move the same export. */
  private async transition(
    tx: DrizzleDB,
    params: {
      id: string;
      from: ExportReportStatus;
      to: ExportReportStatus;
      set: Partial<typeof exportReports.$inferInsert>;
    },
  ): Promise<void> {
    EXPORT_REPORT_STATE_MACHINE.assertTransition(params.from, params.to);
    const rows = await tx
      .update(exportReports)
      .set({ ...params.set, status: params.to, version: sql`${exportReports.version} + 1` })
      .where(
        and(
          eq(exportReports.id, params.id),
          eq(exportReports.status, params.from),
          isNull(exportReports.deletedAt),
        ),
      )
      .returning({ id: exportReports.id });
    if (rows.length === 0) {
      throw new BusinessException(
        ErrorCode.INVALID_STATE_TRANSITION,
        `Export report ${params.id} is not ${params.from}; it cannot become ${params.to}.`,
      );
    }
  }
}
