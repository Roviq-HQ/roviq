import type { CertificateStatus, CertificateTemplateType } from '@roviq/common-types';
import type { I18nContent, issuedCertificates } from '@roviq/database';

export type IssuedCertificateRow = typeof issuedCertificates.$inferSelect;

export interface CertificateTemplateRow {
  id: string;
  type: CertificateTemplateType;
  name: string;
  templateContent: string | null;
  approvalChain: Array<{ role: string }> | null;
}

/** A student with the name fields a certificate prints. */
export interface CertificateStudentRow {
  admissionNumber: string;
  admissionClass: string | null;
  firstName: I18nContent | null;
  lastName: I18nContent | null;
}

export interface CreateIssuedCertificateData {
  templateId: string;
  studentProfileId: string | null;
  staffProfileId: string | null;
  serialNumber: string;
  status: CertificateStatus;
  certificateData: Record<string, unknown>;
  purpose: string;
  actorId: string;
}

export interface MarkCertificateIssuedData {
  id: string;
  /** YYYY-MM-DD */
  issuedDate: string;
  actorId: string;
}

export interface CertificateListFilter {
  type?: CertificateTemplateType;
  status?: CertificateStatus;
  studentProfileId?: string;
}
