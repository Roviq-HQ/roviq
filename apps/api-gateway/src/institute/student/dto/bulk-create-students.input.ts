import { Field, ID, InputType } from '@nestjs/graphql';
import { IsObject, IsUUID } from 'class-validator';
import GraphQLJSON from 'graphql-type-json';

@InputType({ description: 'Input for bulk student import via CSV file' })
export class BulkCreateStudentsInput {
  @Field(() => ID, {
    description: 'File id of the CSV, uploaded with `requestFileUpload` (purpose BULK_IMPORT_CSV).',
  })
  @IsUUID()
  fileId!: string;

  @Field(() => ID, { description: 'Academic year for enrollment' })
  @IsUUID()
  academicYearId!: string;

  @Field(() => ID, { description: 'Default standard (grade level) for all rows unless overridden' })
  @IsUUID()
  standardId!: string;

  @Field(() => ID, { description: 'Default section for all rows unless overridden' })
  @IsUUID()
  sectionId!: string;

  @Field(() => GraphQLJSON, {
    description:
      'Maps CSV column headers to internal field names. Example: { "Student Name": "first_name", "DOB": "date_of_birth" }',
  })
  @IsObject()
  fieldMapping!: Record<string, string>;
}
