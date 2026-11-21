import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import { ComplianceReportType, ExportReportStatus } from '@roviq/common-types';
import { DateOnlyScalar, DateTimeScalar, I18nTextScalar } from '@roviq/nestjs-graphql';

registerEnumType(ComplianceReportType, {
  name: 'ComplianceReportType',
  description:
    'Government or board report format: UDISE+ DCF, CBSE registration (9/11) and LOC (10/12), BSEH staff statement, Shala Darpan (Rajasthan), RTE enrolment, TC register, admission register.',
});

registerEnumType(ExportReportStatus, {
  name: 'ExportReportStatus',
  description: 'PENDING → RUNNING → COMPLETED, or FAILED with an error code.',
});

@ObjectType({ description: 'One requested compliance export, its progress and its file.' })
export class ExportReportModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID, { description: 'The institute the export is of.' })
  tenantId!: string;

  @Field(() => ComplianceReportType)
  reportType!: ComplianceReportType;

  @Field(() => ID)
  academicYearId!: string;

  @Field(() => String, { nullable: true, description: 'Label of the academic year, e.g. 2025-26.' })
  academicYearLabel!: string | null;

  @Field(() => ExportReportStatus)
  status!: ExportReportStatus;

  @Field(() => Int, {
    nullable: true,
    description: 'Records exported (students, staff, classes or TCs); set when COMPLETED.',
  })
  rowCount!: number | null;

  @Field(() => String, {
    nullable: true,
    description:
      'An `ErrorCode` value saying why the export FAILED; translate it, never show it raw.',
  })
  errorCode!: string | null;

  @Field(() => ID, { description: 'The user who asked for the export.' })
  requestedBy!: string;

  @Field(() => I18nTextScalar, {
    nullable: true,
    description: "Requester's first name; null when the caller may not read their profile.",
  })
  requesterFirstName!: Record<string, string> | null;

  @Field(() => I18nTextScalar, { nullable: true })
  requesterLastName!: Record<string, string> | null;

  @Field(() => DateTimeScalar)
  requestedAt!: Date;

  @Field(() => DateTimeScalar, { nullable: true })
  completedAt!: Date | null;

  /** Resolved into `file` by ExportReportFileResolver. */
  fileId!: string | null;
}

@ObjectType({ description: 'An academic year an export can be generated for.' })
export class ExportAcademicYearModel {
  @Field(() => ID)
  id!: string;

  @Field({ description: 'Display label, e.g. 2025-26.' })
  label!: string;

  @Field(() => DateOnlyScalar)
  startDate!: string;

  @Field(() => DateOnlyScalar)
  endDate!: string;

  @Field({ description: 'The institute’s current academic year.' })
  isActive!: boolean;
}
