import type { CertificateTemplateType, InstituteContext } from '@roviq/common-types';
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

/** Access to `issued_certificates` and `certificate_templates` under the caller's institute. */
export abstract class CertificateRepository {
  abstract findTemplate(
    ctx: InstituteContext,
    templateId: string,
  ): Promise<CertificateTemplateRow | null>;
  /** The institute's active templates, by name; of one type when `type` is given. */
  abstract listActiveTemplates(
    ctx: InstituteContext,
    type?: CertificateTemplateType,
  ): Promise<CertificateTemplateSummaryRow[]>;
  abstract staffExists(ctx: InstituteContext, staffProfileId: string): Promise<boolean>;
  abstract findStudent(
    ctx: InstituteContext,
    studentProfileId: string,
  ): Promise<CertificateStudentRow | null>;
  /** Next `CERT/<TYPE>/NNNN` serial from the tenant sequence `cert_no:<TYPE>`. */
  abstract nextSerial(ctx: InstituteContext, certType: string): Promise<string>;
  abstract create(
    ctx: InstituteContext,
    data: CreateIssuedCertificateData,
  ): Promise<IssuedCertificateRow>;
  /** Null when the certificate does not exist. */
  abstract markIssued(
    ctx: InstituteContext,
    data: MarkCertificateIssuedData,
  ): Promise<IssuedCertificateRow | null>;
  abstract findById(ctx: InstituteContext, id: string): Promise<CertificateDetailsRow | null>;
  /**
   * Makes the rendered PENDING file READY and points the certificate at it, in one
   * transaction. False when the certificate already has a PDF.
   */
  abstract attachPdf(
    ctx: InstituteContext,
    data: { certificateId: string; fileId: string; actorId: string },
  ): Promise<boolean>;
  /** At most 50. */
  abstract list(
    ctx: InstituteContext,
    filter: CertificateListFilter,
  ): Promise<CertificateDetailsRow[]>;
}
