import { Field, ID, InputType } from '@nestjs/graphql';
import { ComplianceReportType } from '@roviq/common-types';
import { IsEnum, IsUUID } from 'class-validator';

@InputType({ description: 'Input for generating a compliance export of the caller’s institute.' })
export class ExportComplianceReportInput {
  @Field(() => ComplianceReportType, { description: 'Report format to generate.' })
  @IsEnum(ComplianceReportType)
  reportType!: ComplianceReportType;

  @Field(() => ID, { description: 'Academic year the report data is drawn from.' })
  @IsUUID()
  academicYearId!: string;
}

@InputType({
  description: 'Input for a platform admin generating a compliance export of an institute.',
})
export class AdminExportComplianceReportInput extends ExportComplianceReportInput {
  @Field(() => ID, { description: 'The institute to export.' })
  @IsUUID()
  instituteId!: string;
}
