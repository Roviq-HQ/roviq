import type { InstituteContext } from '@roviq/common-types';
import type {
  CertificateListFilter,
  CertificateStudentRow,
  CertificateTemplateRow,
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
  abstract findById(ctx: InstituteContext, id: string): Promise<IssuedCertificateRow | null>;
  /** At most 50. */
  abstract list(
    ctx: InstituteContext,
    filter: CertificateListFilter,
  ): Promise<IssuedCertificateRow[]>;
}
