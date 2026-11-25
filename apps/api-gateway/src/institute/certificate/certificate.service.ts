/**
 * Certificate service (ROV-161).
 *
 * Handles TC requests/issuance, duplicate TCs, general certificate requests,
 * and Temporal workflow orchestration. Database access lives in the repositories;
 * every call runs under the caller's own institute context.
 */

import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AcademicStatus,
  BusinessException,
  CertificateStatus,
  type CertificateTemplateType,
  ErrorCode,
  type InstituteContext,
  TC_STATE_MACHINE,
  TcStatus,
} from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { TemporalClientService } from '@roviq/temporal';
import { CertificatePdfService } from './certificate-pdf.service';
import type { ClearanceEntryObject } from './models/tc.model';
import { CertificateRepository } from './repositories/certificate.repository';
import type {
  CertificateDetailsRow,
  CertificateListFilter,
  CertificateStudentRow,
  CertificateTemplateSummaryRow,
} from './repositories/certificate.types';
import { TcRepository } from './repositories/tc.repository';
import type { TcDetailsRow, TcListFilter, TcRow } from './repositories/tc.types';
import { DEFAULT_TC_TASK_QUEUE } from './workflows/tc-issuance.types';

/** A TC as the API returns it: clearances as a list instead of the stored department map. */
export type TcRecord = Omit<TcDetailsRow, 'clearances' | 'verificationToken'> & {
  clearances: ClearanceEntryObject[] | undefined;
  /** The public page the TC's QR code opens; null until issued. */
  verificationUrl: string | null;
};

const todayIso = () => new Date().toISOString().split('T')[0];

/** Resolve an i18nText value to one string (en → first → ''). */
function i18nDisplay(value: Record<string, string> | null): string {
  return value ? (value.en ?? Object.values(value)[0] ?? '') : '';
}

@Injectable()
export class CertificateService {
  private readonly logger = new Logger(CertificateService.name);

  constructor(
    private readonly tcs: TcRepository,
    private readonly certificates: CertificateRepository,
    private readonly eventBus: EventBusService,
    private readonly config: ConfigService,
    private readonly pdfs: CertificatePdfService,
    private readonly temporal: TemporalClientService,
  ) {}

  // ── TC Operations ──────────────────────────────────────

  /**
   * Request a Transfer Certificate for a student.
   * Creates tc_register row, starts Temporal TCIssuanceWorkflow.
   */
  async requestTC(
    ctx: InstituteContext,
    input: { studentProfileId: string; reason: string; academicYearId: string },
  ): Promise<TcRecord> {
    const student = await this.tcs.findStudentStatus(ctx, input.studentProfileId);
    if (!student)
      throw new BusinessException(ErrorCode.STUDENT_NOT_FOUND, 'Student profile not found');
    if (student.academicStatus !== AcademicStatus.ENROLLED) {
      throw new BusinessException(
        ErrorCode.STUDENT_NOT_ENROLLED,
        `Student must be enrolled to request TC (current: ${student.academicStatus})`,
      );
    }

    if (!(await this.tcs.academicYearExists(ctx, input.academicYearId))) {
      throw new BusinessException(ErrorCode.ACADEMIC_YEAR_NOT_FOUND, 'Academic year not found');
    }

    // Placeholder serial; the real one is assigned at issuance
    const tc = await this.tcs.createRequest(ctx, {
      studentProfileId: input.studentProfileId,
      academicYearId: input.academicYearId,
      reason: input.reason,
      tempSerial: `TC-REQ-${Date.now()}`,
      actorId: ctx.userId,
    });
    if (!tc) {
      throw new BusinessException(
        ErrorCode.TC_ALREADY_REQUESTED,
        'This student already has a transfer certificate request in progress',
      );
    }

    try {
      const taskQueue = this.config.get<string>('TEMPORAL_TC_TASK_QUEUE', DEFAULT_TC_TASK_QUEUE);
      await this.temporal.startWorkflow('TCIssuanceWorkflow', {
        taskQueue,
        workflowId: `tc-issuance-${tc.id}`,
        workflowExecutionTimeout: '7 days',
        args: [
          {
            tenantId: ctx.tenantId,
            tcRegisterId: tc.id,
            studentProfileId: input.studentProfileId,
            academicYearId: input.academicYearId,
            reason: input.reason,
            requestedBy: ctx.userId,
          },
        ],
      });
      this.logger.log(`TC workflow started: ${tc.id}`);
    } catch (err) {
      this.logger.warn(`Temporal workflow failed to start for TC ${tc.id}: ${err}`);
    }

    return this.getTCDetails(ctx, tc.id);
  }

  /** Approve a TC (principal only via CASL) */
  async approveTC(ctx: InstituteContext, tcId: string): Promise<TcRecord> {
    await this.tcs.approve(ctx, tcId, ctx.userId);
    return this.getTCDetails(ctx, tcId);
  }

  /**
   * Reject a TC request with a reason: CANCELLED (the schema has no `rejected` status), with
   * the reason merged into `tc_data`. Once issued a TC cannot be rejected.
   */
  async rejectTC(ctx: InstituteContext, id: string, reason: string): Promise<TcRecord> {
    await this.tcs.cancel(
      ctx,
      id,
      {
        rejection_reason: reason,
        rejected_by: ctx.userId,
        rejected_at: new Date().toISOString(),
      },
      ctx.userId,
    );
    return this.getTCDetails(ctx, id);
  }

  /** Issue a TC (generates serial, updates student status); a duplicate gets `<original>-D<n>`. */
  async issueTC(ctx: InstituteContext, tcId: string): Promise<TcRecord> {
    const tc = await this.tcs.findById(ctx, tcId);
    if (!tc) throw new BusinessException(ErrorCode.TC_NOT_FOUND, 'TC not found');
    if (tc.isDuplicate) return this.issueDuplicateTC(ctx, tc);
    TC_STATE_MACHINE.assertTransition(tc.status, TcStatus.ISSUED);
    await this.pdfs.assertTcPrintable(ctx, tcId);

    const tcSerialNumber = await this.tcs.issueOriginal(ctx, this.issueData(ctx, tc));
    await this.renderTcPdf(ctx, tcId);
    this.eventBus.emit(EVENT_PATTERNS.TC.issued, {
      tcId,
      studentProfileId: tc.studentProfileId,
      tcSerialNumber,
      tenantId: ctx.tenantId,
      isDuplicate: false,
    });
    return this.getTCDetails(ctx, tcId);
  }

  /** The student already left with the original, so the profile is not touched. */
  private async issueDuplicateTC(ctx: InstituteContext, tc: TcRow): Promise<TcRecord> {
    TC_STATE_MACHINE.assertTransition(tc.status, TcStatus.DUPLICATE_ISSUED);
    await this.pdfs.assertTcPrintable(ctx, tc.id);
    const tcSerialNumber = await this.tcs.issueDuplicate(ctx, this.issueData(ctx, tc));
    await this.renderTcPdf(ctx, tc.id);
    this.eventBus.emit(EVENT_PATTERNS.TC.issued, {
      tcId: tc.id,
      studentProfileId: tc.studentProfileId,
      tcSerialNumber,
      tenantId: ctx.tenantId,
      // Consumers must not treat a duplicate as the student leaving.
      isDuplicate: true,
    });
    return this.getTCDetails(ctx, tc.id);
  }

  private issueData(ctx: InstituteContext, tc: TcRow) {
    return {
      tc,
      today: todayIso(),
      verificationToken: randomBytes(24).toString('base64url'),
      actorId: ctx.userId,
    };
  }

  /**
   * The TC is already issued when this runs, so a storage or render fault must not fail
   * the mutation: the TC keeps no PDF and `generateTCPdf` renders it later.
   */
  private async renderTcPdf(ctx: InstituteContext, tcId: string): Promise<void> {
    try {
      await this.pdfs.ensureTcPdf(ctx, tcId);
    } catch (error) {
      this.logger.error(`PDF of issued TC ${tcId} was not rendered: ${String(error)}`);
    }
  }

  /** Renders the PDF of an issued TC that has none (a failed render at issue). */
  async generateTCPdf(ctx: InstituteContext, tcId: string): Promise<TcRecord> {
    await this.pdfs.ensureTcPdf(ctx, tcId);
    return this.getTCDetails(ctx, tcId);
  }

  /** Renders the PDF of an issued certificate that has none. */
  async generateCertificatePdf(
    ctx: InstituteContext,
    certId: string,
  ): Promise<CertificateDetailsRow> {
    await this.pdfs.ensureCertificatePdf(ctx, certId);
    return this.findCertificateById(ctx, certId);
  }

  /** Clearances are stored as a department map; the API returns them as a list. */
  private toRecord(row: TcDetailsRow): TcRecord {
    const { clearances, verificationToken, ...rest } = row;
    return {
      ...rest,
      verificationUrl: this.pdfs.verificationUrl(verificationToken),
      clearances: clearances
        ? Object.entries(clearances).map(([department, record]) => ({ department, ...record }))
        : undefined,
    };
  }

  async getTCDetails(ctx: InstituteContext, tcId: string): Promise<TcRecord> {
    const row = await this.tcs.findDetails(ctx, tcId);
    if (!row) throw new BusinessException(ErrorCode.TC_NOT_FOUND, 'TC not found');
    return this.toRecord(row);
  }

  async listTCs(ctx: InstituteContext, filter?: TcListFilter): Promise<TcRecord[]> {
    const rows = await this.tcs.list(ctx, filter ?? {});
    return rows.map((row) => this.toRecord(row));
  }

  /**
   * Request duplicate TC (PRD §5.3): a new tc_register row with is_duplicate=true and
   * original_tc_id, skipping clearance.
   */
  async requestDuplicateTC(
    ctx: InstituteContext,
    input: { originalTcId: string; reason: string; duplicateFee?: bigint },
  ): Promise<TcRecord> {
    const original = await this.tcs.findById(ctx, input.originalTcId);
    if (!original) throw new BusinessException(ErrorCode.TC_NOT_FOUND, 'Original TC not found');
    // Only ISSUED may move to DUPLICATE_REQUESTED, so only an issued original is duplicated.
    TC_STATE_MACHINE.assertTransition(original.status, TcStatus.DUPLICATE_REQUESTED);

    const dup = await this.tcs.createDuplicateRequest(ctx, {
      original,
      reason: input.reason,
      duplicateFee: input.duplicateFee ?? null,
      tempSerial: `TC-DUP-${Date.now()}`,
      actorId: ctx.userId,
    });
    if (!dup) {
      throw new BusinessException(
        ErrorCode.TC_ALREADY_REQUESTED,
        'A duplicate of this transfer certificate is already requested',
      );
    }

    return this.getTCDetails(ctx, dup.id);
  }

  // ── Certificate Operations ─────────────────────────────

  async requestCertificate(
    ctx: InstituteContext,
    input: {
      templateId: string;
      studentProfileId?: string;
      staffProfileId?: string;
      purpose: string;
    },
  ): Promise<CertificateDetailsRow> {
    const template = await this.certificates.findTemplate(ctx, input.templateId);
    if (!template)
      throw new BusinessException(
        ErrorCode.CERTIFICATE_TEMPLATE_NOT_FOUND,
        'Certificate template not found',
      );

    // Auto-populate certificate data from the student profile
    let certificateData: Record<string, unknown> = {};
    let student: CertificateStudentRow | null = null;
    if (input.studentProfileId) {
      student = await this.certificates.findStudent(ctx, input.studentProfileId);
      // Before the serial is taken: the foreign key would accept another institute's student.
      if (!student) throw new BusinessException(ErrorCode.STUDENT_NOT_FOUND, 'Student not found');
      certificateData = {
        studentName: `${i18nDisplay(student.firstName)} ${i18nDisplay(student.lastName)}`.trim(),
        admissionNumber: student.admissionNumber,
        class: student.admissionClass,
        purpose: input.purpose,
        date: todayIso(),
      };
    }
    if (input.staffProfileId && !(await this.certificates.staffExists(ctx, input.staffProfileId))) {
      throw new BusinessException(ErrorCode.STAFF_NOT_FOUND, 'Staff member not found');
    }

    const approvalChain = template.approvalChain ?? [];
    const status =
      approvalChain.length > 0 ? CertificateStatus.PENDING_APPROVAL : CertificateStatus.DRAFT;

    const serialNumber = await this.certificates.nextSerial(
      ctx,
      template.type.toUpperCase().slice(0, 3),
    );

    const created = await this.certificates.create(ctx, {
      templateId: input.templateId,
      studentProfileId: input.studentProfileId ?? null,
      staffProfileId: input.staffProfileId ?? null,
      serialNumber,
      status,
      certificateData,
      purpose: input.purpose,
      actorId: ctx.userId,
    });
    return {
      ...created,
      studentFirstName: student?.firstName ?? null,
      studentLastName: student?.lastName ?? null,
      studentAdmissionNumber: student?.admissionNumber ?? null,
    };
  }

  async issueCertificate(ctx: InstituteContext, certId: string): Promise<CertificateDetailsRow> {
    await this.pdfs.assertCertificatePrintable(ctx, certId);
    const issued = await this.certificates.markIssued(ctx, {
      id: certId,
      issuedDate: todayIso(),
      actorId: ctx.userId,
    });
    if (!issued)
      throw new BusinessException(ErrorCode.CERTIFICATE_NOT_FOUND, 'Certificate not found');
    try {
      await this.pdfs.ensureCertificatePdf(ctx, certId);
    } catch (error) {
      this.logger.error(`PDF of issued certificate ${certId} was not rendered: ${String(error)}`);
    }

    const template = await this.certificates.findTemplate(ctx, issued.templateId);
    this.eventBus.emit(EVENT_PATTERNS.CERTIFICATE.generated, {
      certificateId: certId,
      type: template?.type ?? 'unknown',
      tenantId: ctx.tenantId,
    });

    return this.findCertificateById(ctx, certId);
  }

  async findCertificateById(ctx: InstituteContext, id: string): Promise<CertificateDetailsRow> {
    const row = await this.certificates.findById(ctx, id);
    if (!row) throw new BusinessException(ErrorCode.CERTIFICATE_NOT_FOUND, 'Certificate not found');
    return row;
  }

  listCertificateTemplates(
    ctx: InstituteContext,
    type?: CertificateTemplateType,
  ): Promise<CertificateTemplateSummaryRow[]> {
    return this.certificates.listActiveTemplates(ctx, type);
  }

  /**
   * Handlebars-style placeholder names in the template's content. A template without content
   * (legacy rows, still in setup) falls back to a fixed list per certificate type.
   */
  async getCertificateTemplateFields(ctx: InstituteContext, templateId: string): Promise<string[]> {
    const template = await this.certificates.findTemplate(ctx, templateId);
    if (!template)
      throw new BusinessException(
        ErrorCode.CERTIFICATE_TEMPLATE_NOT_FOUND,
        'Certificate template not found',
      );

    const content = template.templateContent;
    if (content && content.length > 0) {
      const seen = new Set<string>();
      const fields: string[] = [];
      const re = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
      let match: RegExpExecArray | null = re.exec(content);
      while (match !== null) {
        const name = match[1];
        if (!seen.has(name)) {
          seen.add(name);
          fields.push(name);
        }
        match = re.exec(content);
      }
      if (fields.length > 0) return fields;
    }

    const defaults: Record<string, string[]> = {
      bonafide_certificate: ['studentName', 'admissionNumber', 'class', 'dateOfIssue', 'purpose'],
      character_certificate: ['studentName', 'admissionNumber', 'class', 'dateOfIssue', 'purpose'],
      study_certificate: ['studentName', 'admissionNumber', 'class', 'dateOfIssue', 'purpose'],
      transfer_certificate: ['studentName', 'admissionNumber', 'class', 'dateOfIssue', 'purpose'],
      school_leaving_certificate: [
        'studentName',
        'admissionNumber',
        'class',
        'dateOfIssue',
        'purpose',
      ],
    };
    return (
      defaults[template.type] ?? [
        'studentName',
        'admissionNumber',
        'class',
        'dateOfIssue',
        'purpose',
      ]
    );
  }

  /**
   * Renders a preview of a certificate by substituting student data into the template body
   * (shown in an `<iframe srcdoc>`). Writes nothing. A template without content uses a fixed
   * body with the same placeholders.
   */
  async previewCertificate(
    ctx: InstituteContext,
    input: { templateId: string; studentProfileId: string; purpose?: string },
  ): Promise<string> {
    const template = await this.certificates.findTemplate(ctx, input.templateId);
    if (!template)
      throw new BusinessException(
        ErrorCode.CERTIFICATE_TEMPLATE_NOT_FOUND,
        'Certificate template not found',
      );

    const student = await this.certificates.findStudent(ctx, input.studentProfileId);
    if (!student) throw new BusinessException(ErrorCode.STUDENT_NOT_FOUND, 'Student not found');

    const firstName = i18nDisplay(student.firstName);
    const lastName = i18nDisplay(student.lastName);

    const data: Record<string, string> = {
      studentName: `${firstName} ${lastName}`.trim(),
      firstName,
      lastName,
      admissionNumber: student.admissionNumber ?? '',
      class: student.admissionClass ?? '',
      dateOfIssue: todayIso() ?? '',
      purpose: input.purpose ?? '',
    };

    const defaultBodyByType: Record<string, string> = {
      bonafide_certificate: `<h1 style="text-align:center">Bonafide Certificate</h1>
<p>This is to certify that <strong>{{studentName}}</strong>, bearing admission number
<strong>{{admissionNumber}}</strong>, is a bonafide student of class <strong>{{class}}</strong> of this institute.</p>
<p>This certificate is issued for the purpose of: <em>{{purpose}}</em>.</p>
<p>Date of issue: {{dateOfIssue}}</p>`,
      character_certificate: `<h1 style="text-align:center">Character Certificate</h1>
<p>This is to certify that <strong>{{studentName}}</strong> (admission number
<strong>{{admissionNumber}}</strong>), student of class <strong>{{class}}</strong>, bears a good moral character
to the best of our knowledge.</p>
<p>Issued for: <em>{{purpose}}</em>. Date: {{dateOfIssue}}.</p>`,
      study_certificate: `<h1 style="text-align:center">Study Certificate</h1>
<p>This is to certify that <strong>{{studentName}}</strong>, admission number
<strong>{{admissionNumber}}</strong>, is pursuing studies in class <strong>{{class}}</strong> at this institute.</p>
<p>Purpose: {{purpose}}. Date: {{dateOfIssue}}.</p>`,
    };

    const body =
      template.templateContent && template.templateContent.length > 0
        ? template.templateContent
        : (defaultBodyByType[template.type] ??
          `<h1 style="text-align:center">${template.name}</h1>
<p>Student: <strong>{{studentName}}</strong></p>
<p>Admission number: <strong>{{admissionNumber}}</strong></p>
<p>Class: <strong>{{class}}</strong></p>
<p>Purpose: {{purpose}}. Date: {{dateOfIssue}}.</p>`);

    const rendered = body.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, key: string) => {
      return data[key] ?? '';
    });

    return `<!doctype html><html><head><meta charset="utf-8"><title>${template.name}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;padding:24px;line-height:1.5;color:#0f172a}
h1{font-size:20px;margin:0 0 16px}p{margin:8px 0}</style></head><body>${rendered}</body></html>`;
  }

  listCertificates(
    ctx: InstituteContext,
    filter?: CertificateListFilter,
  ): Promise<CertificateDetailsRow[]> {
    return this.certificates.list(ctx, filter ?? {});
  }
}
