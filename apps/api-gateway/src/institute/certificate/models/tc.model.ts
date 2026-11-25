import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { CertificateStatus, type CertificateTemplateType, TcStatus } from '@roviq/common-types';
import type { I18nContent } from '@roviq/database';
import { DateTimeScalar, I18nTextScalar } from '@roviq/nestjs-graphql';
import GraphQLJSON from 'graphql-type-json';

@ObjectType({ description: 'Department clearance record for TC workflow' })
export class ClearanceEntryObject {
  @Field({ description: 'Department name (e.g. accounts, library, lab, transport)' })
  department!: string;

  @Field({ description: 'Whether this department has cleared the student' })
  cleared!: boolean;

  @Field({ nullable: true, description: 'User ID who cleared' })
  by?: string;

  @Field({ nullable: true, description: 'ISO timestamp when cleared' })
  at?: string;

  @Field({ nullable: true, description: 'Optional notes from the department' })
  notes?: string;
}

registerEnumType(TcStatus, { name: 'TcStatus' });
registerEnumType(CertificateStatus, { name: 'CertificateStatus' });

@ObjectType({ description: 'Transfer Certificate register entry' })
export class TCModel {
  @Field(() => ID)
  id!: string;

  @Field()
  studentProfileId!: string;

  @Field(() => I18nTextScalar, {
    description: "Student first name (i18n) joined from the institute's profile copy",
  })
  studentFirstName!: I18nContent;

  @Field(() => I18nTextScalar, {
    nullable: true,
    description: "Student last name (i18n) joined from the institute's profile copy",
  })
  studentLastName?: I18nContent | null;

  @Field(() => I18nTextScalar, {
    nullable: true,
    description:
      "Student's standard in the TC's academic year (i18n); null without an academic record",
  })
  standardName?: I18nContent | null;

  @Field()
  tcSerialNumber!: string;

  @Field()
  academicYearId!: string;

  @Field(() => TcStatus)
  status!: TcStatus;

  @Field()
  reason!: string;

  /** 20+ CBSE fields snapshotted at generation — dynamic per board, kept as JSON */
  @Field(() => GraphQLJSON, {
    nullable: true,
    description: 'CBSE TC fields frozen at generation (see CbseTcData)',
  })
  tcData?: Record<string, unknown>;

  @Field(() => [ClearanceEntryObject], {
    nullable: true,
    description: 'Department clearance records',
  })
  clearances?: ClearanceEntryObject[];

  /** Resolved into `pdf` by TcPdfResolver. */
  pdfFileId!: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'Public page the QR code on the TC opens; null until the TC is issued',
  })
  verificationUrl?: string | null;

  @Field(() => Boolean)
  isDuplicate!: boolean;

  @Field(() => String, {
    nullable: true,
    description: 'For a duplicate, the issued TC it copies; null on an original',
  })
  originalTcId?: string | null;

  @Field(() => Boolean, { nullable: true })
  isCounterSigned?: boolean | null;

  @Field(() => DateTimeScalar)
  createdAt!: Date;
}

@ObjectType({ description: 'Issued certificate (bonafide, character, etc.)' })
export class CertificateModel {
  @Field(() => ID)
  id!: string;

  @Field()
  templateId!: string;

  @Field(() => String, { nullable: true })
  studentProfileId?: string | null;

  @Field(() => String, { nullable: true })
  staffProfileId?: string | null;

  @Field()
  serialNumber!: string;

  @Field(() => CertificateStatus)
  status!: CertificateStatus;

  // Drizzle types jsonb columns as `unknown` (the contents are template-driven
  // and depend on the certificate's template type). Keep the field type
  // aligned with `issuedCertificates.$inferSelect` so resolvers don't need
  // `as Promise<CertificateModel>` casts (CE-001).
  @Field(() => GraphQLJSON)
  certificateData!: unknown;

  /** Resolved into `pdf` by CertificatePdfResolver. */
  pdfFileId!: string | null;

  @Field(() => String, { nullable: true })
  purpose?: string | null;

  @Field(() => DateTimeScalar)
  createdAt!: Date;
}

@ObjectType({ description: 'A certificate template staff pick by name when issuing a certificate' })
export class CertificateTemplateModel {
  @Field(() => ID)
  id!: string;

  @Field({ description: 'Name shown in the picker, e.g. "Bonafide (CBSE)"' })
  name!: string;

  @Field(() => String, { description: 'Certificate type, e.g. BONAFIDE_CERTIFICATE' })
  type!: CertificateTemplateType;
}
