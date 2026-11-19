import { Field, ID, InputType } from '@nestjs/graphql';
import { UserDocumentType } from '@roviq/common-types';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

/** Most pages one document may have. */
export const MAX_DOCUMENT_FILES = 10;

@InputType({
  description:
    "A document for a student. Upload each page first with `requestFileUpload` (purpose USER_DOCUMENT, `subjectUserId` = the student's user), then pass the file ids here.",
})
export class UploadStudentDocumentInput {
  @Field(() => ID, { description: 'Target student profile ID (tenant-scoped UUIDv7).' })
  @IsUUID()
  @IsNotEmpty()
  studentProfileId!: string;

  @Field(() => UserDocumentType, {
    description:
      'Document category — must match one of the 17 values enforced by the user_documents.type CHECK constraint.',
  })
  @IsEnum(UserDocumentType)
  type!: UserDocumentType;

  @Field(() => String, {
    nullable: true,
    description: 'Optional human-readable description of the document contents.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @Field(() => [ID], {
    description: `Ids of the uploaded pages, in page order. 1 to ${MAX_DOCUMENT_FILES} files.`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_DOCUMENT_FILES)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  fileIds!: string[];

  @Field(() => String, {
    nullable: true,
    description:
      'Document reference number for traceability, e.g. TC number, certificate serial number.',
  })
  @IsOptional()
  @IsString()
  referenceNumber?: string;
}
