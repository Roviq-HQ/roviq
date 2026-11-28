import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BusinessException,
  type CbseTcData,
  CertificateStatus,
  type CertificateTemplateType,
  ErrorCode,
  FILE_CONTENT_TYPE,
  type InstituteContext,
  TcStatus,
} from '@roviq/common-types';
import type { I18nContent } from '@roviq/database';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { WorkflowFileStore } from '../../files/workflow-file-store';
import { type PdfData, PdfService } from '../../pdf/pdf.service';
import { CERTIFICATE_TEMPLATE } from '../../pdf/templates/certificate.template';
import { TC_TEMPLATE } from '../../pdf/templates/tc.template';
import { CertificateRepository } from './repositories/certificate.repository';
import type {
  CertificateTemplateRow,
  IssuedCertificateRow,
} from './repositories/certificate.types';
import { TcRepository } from './repositories/tc.repository';
import type { InstituteLetterheadRow, TcDetailsRow } from './repositories/tc.types';

const ISSUED_TC_STATUSES: readonly TcStatus[] = [TcStatus.ISSUED, TcStatus.DUPLICATE_ISSUED];

/** The CBSE transfer certificate rows, in printed order. */
const TC_FIELDS: ReadonlyArray<{ label: string; key: keyof CbseTcData & string }> = [
  { label: 'Name of the pupil', key: 'studentName' },
  { label: "Mother's name", key: 'motherName' },
  { label: "Father's / guardian's name", key: 'fatherOrGuardianName' },
  { label: 'Nationality', key: 'nationality' },
  { label: 'Whether the pupil belongs to SC / ST / OBC', key: 'socialCategory' },
  {
    label: 'Date of birth according to the admission register (in figures)',
    key: 'dateOfBirthFigures',
  },
  { label: 'Date of birth (in words)', key: 'dateOfBirthWords' },
  {
    label: 'Whether the pupil is failed, if so once / twice in the same class',
    key: 'whetherFailed',
  },
  { label: 'Subjects offered', key: 'subjectsStudied' },
  { label: 'Class in which the pupil last studied', key: 'classLastStudied' },
  { label: 'Last examination taken with result', key: 'lastExamResult' },
  {
    label: 'Whether qualified for promotion to the next higher class',
    key: 'qualifiedForPromotion',
  },
  { label: 'Whether the pupil has paid all dues to the institute', key: 'feesPaidUpTo' },
  { label: 'Whether the pupil was in receipt of any fee concession', key: 'feeConcession' },
  { label: 'Whether the pupil is NCC cadet / Boy Scout / Girl Guide', key: 'nccScoutGuide' },
  { label: "Date on which the pupil's name was struck off the rolls", key: 'dateOfLeaving' },
  { label: 'Reason for leaving the institute', key: 'reasonForLeaving' },
  { label: 'Total number of working days in the academic session', key: 'totalWorkingDays' },
  { label: 'Number of working days the pupil was present', key: 'totalPresentDays' },
  { label: 'General conduct', key: 'generalConduct' },
  { label: 'Any other remarks', key: 'remarks' },
  { label: 'Date of issue of certificate', key: 'dateOfIssue' },
];

const CERTIFICATE_TITLES: { readonly [T in CertificateTemplateType]?: string } = {
  BONAFIDE_CERTIFICATE: 'Bonafide Certificate',
  CHARACTER_CERTIFICATE: 'Character Certificate',
  STUDY_CERTIFICATE: 'Study Certificate',
  SCHOOL_LEAVING_CERTIFICATE: 'Leaving Certificate',
  DOB_CERTIFICATE: 'Date of Birth Certificate',
  NO_DUES_CERTIFICATE: 'No Dues Certificate',
  ATTENDANCE_CERTIFICATE: 'Attendance Certificate',
  CONDUCT_CERTIFICATE: 'Conduct Certificate',
  SPORTS_CERTIFICATE: 'Sports Certificate',
};

const DEFAULT_CERTIFICATE_BODY =
  'This is to certify that {{studentName}}, admission number {{admissionNumber}}, is a student of class {{class}} of this institute.\n\nThis certificate is issued for the purpose of: {{purpose}}.';

function displayText(value: I18nContent | null): string {
  return value ? (value.en ?? Object.values(value)[0] ?? '') : '';
}

/** `2026-11-21` → `21/11/2026`; anything else is printed as stored. */
function printDate(value: string | null | undefined): string {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return match ? `${match[3]}/${match[2]}/${match[1]}` : (value ?? '');
}

function letterheadData(letterhead: InstituteLetterheadRow): PdfData {
  const address = letterhead.address;
  const addressLine = address
    ? [address.line1, address.line2, address.line3, address.city, address.district, address.state]
        .filter((part): part is string => Boolean(part))
        .join(', ') + (address.postalCode ? ` - ${address.postalCode}` : '')
    : null;
  const affiliation = letterhead.affiliationNumber
    ? `${letterhead.board ?? ''} Affiliation No. ${letterhead.affiliationNumber}`.trim()
    : null;
  return { name: displayText(letterhead.name), address: addressLine, affiliation };
}

/**
 * Fills `{{name}}` placeholders with values and drops any markup. The result is plain
 * text for the PDF: institute-authored template text never reaches Typst as source.
 */
export function fillCertificateBody(content: string, values: Record<string, unknown>): string[] {
  const text = content
    .replace(/<\s*(br|\/p|\/div|\/h[1-6])\s*\/?>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_match, name: string) => {
      const value = values[name];
      return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
    });
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 0);
}

@Injectable()
export class CertificatePdfService {
  private readonly logger = new Logger(CertificatePdfService.name);

  constructor(
    private readonly pdf: PdfService,
    private readonly tcs: TcRepository,
    private readonly certificates: CertificateRepository,
    private readonly fileStore: WorkflowFileStore,
    private readonly config: ConfigService,
  ) {}

  /** The public page a TC's QR code opens; null before the TC is issued. */
  verificationUrl(token: string | null): string | null {
    if (!token) return null;
    const base =
      this.config.get<string>('INSTITUTE_PORTAL_URL') ??
      `http://localhost:${this.config.get<string>('WEB_PORT') ?? '4200'}`;
    return `${base.replace(/\/+$/, '')}/verify/tc/${token}`;
  }

  /** Throws PDF_UNSUPPORTED_SCRIPT now, so a TC is not issued and then found unprintable. */
  async assertTcPrintable(ctx: InstituteContext, tcId: string): Promise<void> {
    const tc = await this.requireTc(ctx, tcId);
    const letterhead = await this.requireLetterhead(ctx);
    this.pdf.assertRenderable(this.tcData(tc, letterhead, false));
  }

  /** Renders and stores the PDF of an issued TC that has none yet. */
  async ensureTcPdf(ctx: InstituteContext, tcId: string): Promise<void> {
    const tc = await this.requireTc(ctx, tcId);
    if (tc.pdfFileId) return;
    if (!ISSUED_TC_STATUSES.includes(tc.status)) {
      throw new BusinessException(ErrorCode.PDF_NOT_READY, 'The TC is not issued yet');
    }
    const url = this.verificationUrl(tc.verificationToken);
    if (!url) throw new Error(`Issued TC ${tc.id} has no verification token`);
    const letterhead = await this.requireLetterhead(ctx);
    const logo = await this.logo(ctx, letterhead);
    const qr = await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });

    const body = this.pdf.render({
      template: TC_TEMPLATE,
      data: this.tcData(tc, letterhead, logo !== null),
      files: { '/qr.svg': Buffer.from(qr), ...(logo ? { '/logo.png': logo } : {}) },
    });
    const fileId = randomUUID();
    await this.fileStore.putPending({
      tenantId: ctx.tenantId,
      fileId,
      purpose: 'TC_PDF',
      fileName: `TC-${tc.tcSerialNumber.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`,
      contentType: FILE_CONTENT_TYPE.PDF,
      body,
      createdBy: ctx.userId,
    });
    await this.tcs.attachPdf(ctx, { tcId: tc.id, fileId, actorId: ctx.userId });
  }

  /** Renders and stores the PDF of an issued certificate that has none yet. */
  async ensureCertificatePdf(ctx: InstituteContext, certificateId: string): Promise<void> {
    const certificate = await this.certificates.findById(ctx, certificateId);
    if (!certificate) {
      throw new BusinessException(ErrorCode.CERTIFICATE_NOT_FOUND, 'Certificate not found');
    }
    if (certificate.pdfFileId) return;
    if (certificate.status !== CertificateStatus.ISSUED) {
      throw new BusinessException(ErrorCode.PDF_NOT_READY, 'The certificate is not issued yet');
    }
    const template = await this.certificates.findTemplate(ctx, certificate.templateId);
    if (!template) {
      throw new BusinessException(
        ErrorCode.CERTIFICATE_TEMPLATE_NOT_FOUND,
        'Certificate template not found',
      );
    }
    const letterhead = await this.requireLetterhead(ctx);
    const logo = await this.logo(ctx, letterhead);
    const body = this.pdf.render({
      template: CERTIFICATE_TEMPLATE,
      data: this.certificateData(certificate, template, letterhead, logo !== null),
      files: logo ? { '/logo.png': logo } : {},
    });
    const fileId = randomUUID();
    await this.fileStore.putPending({
      tenantId: ctx.tenantId,
      fileId,
      purpose: 'CERTIFICATE_PDF',
      fileName: `${certificate.serialNumber.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`,
      contentType: FILE_CONTENT_TYPE.PDF,
      body,
      createdBy: ctx.userId,
    });
    await this.certificates.attachPdf(ctx, { certificateId, fileId, actorId: ctx.userId });
  }

  /** Throws PDF_UNSUPPORTED_SCRIPT before the certificate is marked issued. */
  async assertCertificatePrintable(ctx: InstituteContext, certificateId: string): Promise<void> {
    const certificate = await this.certificates.findById(ctx, certificateId);
    if (!certificate) {
      throw new BusinessException(ErrorCode.CERTIFICATE_NOT_FOUND, 'Certificate not found');
    }
    const template = await this.certificates.findTemplate(ctx, certificate.templateId);
    if (!template) return;
    const letterhead = await this.requireLetterhead(ctx);
    this.pdf.assertRenderable(this.certificateData(certificate, template, letterhead, false));
  }

  private tcData(tc: TcDetailsRow, letterhead: InstituteLetterheadRow, hasLogo: boolean): PdfData {
    const dates: ReadonlySet<string> = new Set([
      'dateOfBirthFigures',
      'dateOfLeaving',
      'dateOfIssue',
    ]);
    return {
      institute: letterheadData(letterhead),
      hasLogo,
      serial: tc.tcSerialNumber,
      admissionNumber: tc.admissionNumber,
      isDuplicate: tc.isDuplicate,
      originalSerial: null,
      issuedOn: printDate(tc.tcData.dateOfIssue),
      verifyUrl: this.verificationUrl(tc.verificationToken) ?? '',
      fields: TC_FIELDS.map((field, index) => {
        const value = tc.tcData[field.key];
        return {
          no: `${index + 1}.`,
          label: field.label,
          value: dates.has(field.key) ? printDate(value) : (value ?? ''),
        };
      }),
    };
  }

  private certificateData(
    certificate: IssuedCertificateRow,
    template: CertificateTemplateRow,
    letterhead: InstituteLetterheadRow,
    hasLogo: boolean,
  ): PdfData {
    const stored = certificate.certificateData;
    const values: Record<string, unknown> =
      stored !== null && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {};
    values.purpose ??= certificate.purpose ?? '';
    const content =
      template.templateContent && template.templateContent.trim().length > 0
        ? template.templateContent
        : DEFAULT_CERTIFICATE_BODY;
    return {
      institute: letterheadData(letterhead),
      hasLogo,
      serial: certificate.serialNumber,
      issuedOn: printDate(certificate.issuedDate),
      title: CERTIFICATE_TITLES[template.type] ?? template.name,
      body: fillCertificateBody(content, values),
    };
  }

  private async logo(
    ctx: InstituteContext,
    letterhead: InstituteLetterheadRow,
  ): Promise<Buffer | null> {
    if (!letterhead.logoFileId) return null;
    try {
      const webp = await this.fileStore.readImage(
        ctx.tenantId,
        letterhead.logoFileId,
        'INSTITUTE_LOGO',
      );
      return webp ? await sharp(webp).png().toBuffer() : null;
    } catch (error) {
      // A certificate without its logo is still valid; one that cannot be issued is not.
      this.logger.warn({ err: error }, 'Institute logo could not be read for the PDF');
      return null;
    }
  }

  private async requireTc(ctx: InstituteContext, tcId: string): Promise<TcDetailsRow> {
    const tc = await this.tcs.findDetails(ctx, tcId);
    if (!tc) throw new BusinessException(ErrorCode.TC_NOT_FOUND, 'TC not found');
    return tc;
  }

  private async requireLetterhead(ctx: InstituteContext): Promise<InstituteLetterheadRow> {
    const letterhead = await this.tcs.findLetterhead(ctx);
    if (!letterhead) throw new Error(`Institute ${ctx.tenantId} not found for its own PDF`);
    return letterhead;
  }
}
