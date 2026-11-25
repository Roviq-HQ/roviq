import { Inject, Injectable } from '@nestjs/common';
import {
  CertificateStatus,
  type CertificateTemplateType,
  type InstituteContext,
} from '@roviq/common-types';
import {
  certificateTemplatesLive,
  DRIZZLE_DB,
  type DrizzleDB,
  issuedCertificates,
  issuedCertificatesLive,
  staffProfilesLive,
  studentProfilesLive,
  tenantSequences,
  tenantUserProfilesLive,
  withTenant,
} from '@roviq/database';
import { and, asc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import { markFilesReady } from '../../../files/file-attachment';
import { CertificateRepository } from './certificate.repository';
import type {
  CertificateDetailsRow,
  CertificateListFilter,
  CertificateStudentRow,
  CertificateTemplateRow,
  CertificateTemplateSummaryRow,
  CreateIssuedCertificateData,
  IssuedCertificateRow,
  MarkCertificateIssuedData,
} from './certificate.types';

@Injectable()
export class CertificateDrizzleRepository extends CertificateRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async findTemplate(
    ctx: InstituteContext,
    templateId: string,
  ): Promise<CertificateTemplateRow | null> {
    const [row] = await withTenant(this.db, ctx, (tx) =>
      tx
        .select({
          id: certificateTemplatesLive.id,
          type: certificateTemplatesLive.type,
          name: certificateTemplatesLive.name,
          templateContent: certificateTemplatesLive.templateContent,
          approvalChain: certificateTemplatesLive.approvalChain,
          isActive: certificateTemplatesLive.isActive,
        })
        .from(certificateTemplatesLive)
        .where(eq(certificateTemplatesLive.id, templateId))
        .limit(1),
    );
    return row ?? null;
  }

  async listActiveTemplates(
    ctx: InstituteContext,
    type?: CertificateTemplateType,
  ): Promise<CertificateTemplateSummaryRow[]> {
    const conditions: SQL[] = [eq(certificateTemplatesLive.isActive, true)];
    if (type) conditions.push(eq(certificateTemplatesLive.type, type));
    return withTenant(this.db, ctx, (tx) =>
      tx
        .select({
          id: certificateTemplatesLive.id,
          type: certificateTemplatesLive.type,
          name: certificateTemplatesLive.name,
        })
        .from(certificateTemplatesLive)
        .where(and(...conditions))
        .orderBy(asc(certificateTemplatesLive.name)),
    );
  }

  async staffExists(ctx: InstituteContext, staffProfileId: string): Promise<boolean> {
    const rows = await withTenant(this.db, ctx, (tx) =>
      tx
        .select({ id: staffProfilesLive.id })
        .from(staffProfilesLive)
        .where(eq(staffProfilesLive.id, staffProfileId))
        .limit(1),
    );
    return rows.length > 0;
  }

  async findStudent(
    ctx: InstituteContext,
    studentProfileId: string,
  ): Promise<CertificateStudentRow | null> {
    const [row] = await withTenant(this.db, ctx, (tx) =>
      tx
        .select({
          admissionNumber: studentProfilesLive.admissionNumber,
          admissionClass: studentProfilesLive.admissionClass,
          firstName: tenantUserProfilesLive.firstName,
          lastName: tenantUserProfilesLive.lastName,
        })
        .from(studentProfilesLive)
        .leftJoin(
          tenantUserProfilesLive,
          and(
            eq(tenantUserProfilesLive.userId, studentProfilesLive.userId),
            eq(tenantUserProfilesLive.tenantId, studentProfilesLive.tenantId),
          ),
        )
        .where(eq(studentProfilesLive.id, studentProfileId))
        .limit(1),
    );
    return row ?? null;
  }

  nextSerial(ctx: InstituteContext, certType: string): Promise<string> {
    const sequenceName = `cert_no:${certType}`;
    return withTenant(this.db, ctx, async (tx) => {
      await tx
        .insert(tenantSequences)
        .values({
          tenantId: ctx.tenantId,
          sequenceName,
          currentValue: 0n,
          formatTemplate: `CERT/${certType}/{value:04d}`,
        })
        .onConflictDoNothing();

      const result = await tx.execute<{ next_val: string; formatted: string }>(
        sql`SELECT * FROM next_sequence_value(${ctx.tenantId}::uuid, ${sequenceName})`,
      );
      const row = result.rows[0];
      return row?.formatted || `CERT/${certType}/${row?.next_val}`;
    });
  }

  async create(
    ctx: InstituteContext,
    data: CreateIssuedCertificateData,
  ): Promise<IssuedCertificateRow> {
    const [row] = await withTenant(this.db, ctx, (tx) =>
      tx
        .insert(issuedCertificates)
        .values({
          tenantId: ctx.tenantId,
          templateId: data.templateId,
          studentProfileId: data.studentProfileId,
          staffProfileId: data.staffProfileId,
          serialNumber: data.serialNumber,
          status: data.status,
          certificateData: data.certificateData,
          purpose: data.purpose,
          createdBy: data.actorId,
          updatedBy: data.actorId,
        })
        .returning(),
    );
    if (!row) throw new Error('issued_certificates insert returned no row');
    return row;
  }

  async markIssued(
    ctx: InstituteContext,
    data: MarkCertificateIssuedData,
  ): Promise<IssuedCertificateRow | null> {
    const [row] = await withTenant(this.db, ctx, (tx) =>
      tx
        .update(issuedCertificates)
        .set({
          status: CertificateStatus.ISSUED,
          issuedDate: data.issuedDate,
          issuedBy: data.actorId,
          updatedBy: data.actorId,
        })
        .where(eq(issuedCertificates.id, data.id))
        .returning(),
    );
    return row ?? null;
  }

  attachPdf(
    ctx: InstituteContext,
    data: { certificateId: string; fileId: string; actorId: string },
  ): Promise<boolean> {
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .update(issuedCertificates)
        .set({ pdfFileId: data.fileId, updatedBy: data.actorId })
        .where(
          and(eq(issuedCertificates.id, data.certificateId), isNull(issuedCertificates.pdfFileId)),
        )
        .returning({ id: issuedCertificates.id });
      if (rows.length === 0) return false;
      await markFilesReady(tx, {
        fileIds: [data.fileId],
        purpose: 'CERTIFICATE_PDF',
        userId: data.actorId,
      });
      return true;
    });
  }

  async findById(ctx: InstituteContext, id: string): Promise<CertificateDetailsRow | null> {
    const [row] = await withTenant(this.db, ctx, (tx) =>
      selectDetails(tx).where(eq(issuedCertificatesLive.id, id)).limit(1),
    );
    return row ?? null;
  }

  list(ctx: InstituteContext, filter: CertificateListFilter): Promise<CertificateDetailsRow[]> {
    return withTenant(this.db, ctx, async (tx) => {
      const conditions: SQL[] = [];
      if (filter.status) conditions.push(eq(issuedCertificatesLive.status, filter.status));
      if (filter.studentProfileId)
        conditions.push(eq(issuedCertificatesLive.studentProfileId, filter.studentProfileId));

      // Template ids first: Drizzle's `{ cert: view }` select shorthand does not accept views.
      if (filter.type) {
        const templateIds = await tx
          .select({ id: certificateTemplatesLive.id })
          .from(certificateTemplatesLive)
          .where(eq(certificateTemplatesLive.type, filter.type));
        if (templateIds.length === 0) return [];
        conditions.push(
          inArray(
            issuedCertificatesLive.templateId,
            templateIds.map((t) => t.id),
          ),
        );
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;
      return selectDetails(tx).where(where).limit(50);
    });
  }
}

/**
 * A certificate with its student's name and admission number. Left joins: a staff certificate
 * has no student, and a deleted student's profile is gone from the live views.
 */
function selectDetails(tx: DrizzleDB) {
  return tx
    .select({
      // Named one by one: `getColumns(view)` yields the base table's columns, which render
      // as "issued_certificates"."id" and fail outside the view.
      id: issuedCertificatesLive.id,
      tenantId: issuedCertificatesLive.tenantId,
      templateId: issuedCertificatesLive.templateId,
      studentProfileId: issuedCertificatesLive.studentProfileId,
      staffProfileId: issuedCertificatesLive.staffProfileId,
      serialNumber: issuedCertificatesLive.serialNumber,
      status: issuedCertificatesLive.status,
      certificateData: issuedCertificatesLive.certificateData,
      pdfFileId: issuedCertificatesLive.pdfFileId,
      issuedDate: issuedCertificatesLive.issuedDate,
      issuedBy: issuedCertificatesLive.issuedBy,
      purpose: issuedCertificatesLive.purpose,
      validUntil: issuedCertificatesLive.validUntil,
      createdAt: issuedCertificatesLive.createdAt,
      updatedAt: issuedCertificatesLive.updatedAt,
      createdBy: issuedCertificatesLive.createdBy,
      updatedBy: issuedCertificatesLive.updatedBy,
      deletedAt: issuedCertificatesLive.deletedAt,
      deletedBy: issuedCertificatesLive.deletedBy,
      version: issuedCertificatesLive.version,
      studentFirstName: tenantUserProfilesLive.firstName,
      studentLastName: tenantUserProfilesLive.lastName,
      studentAdmissionNumber: studentProfilesLive.admissionNumber,
    })
    .from(issuedCertificatesLive)
    .leftJoin(
      studentProfilesLive,
      eq(studentProfilesLive.id, issuedCertificatesLive.studentProfileId),
    )
    .leftJoin(
      tenantUserProfilesLive,
      and(
        eq(tenantUserProfilesLive.userId, studentProfilesLive.userId),
        eq(tenantUserProfilesLive.tenantId, studentProfilesLive.tenantId),
      ),
    );
}
