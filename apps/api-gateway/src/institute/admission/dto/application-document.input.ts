import { Field, ID, InputType } from '@nestjs/graphql';
import { UserDocumentType } from '@roviq/common-types';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsEnum, IsUUID } from 'class-validator';

/** Most pages one document may have. */
export const MAX_APPLICATION_DOCUMENT_FILES = 10;

@InputType({
  description:
    'A document submitted with an admission application. Upload each page first with `requestFileUpload` (purpose APPLICATION_DOCUMENT), then pass the file ids here.',
})
export class AddApplicationDocumentInput {
  @Field(() => ID)
  @IsUUID()
  applicationId!: string;

  @Field(() => UserDocumentType, {
    description: 'Document category; the same list as student documents.',
  })
  @IsEnum(UserDocumentType)
  type!: UserDocumentType;

  @Field(() => [ID], {
    description: `Ids of the uploaded pages, in page order. 1 to ${MAX_APPLICATION_DOCUMENT_FILES} files.`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_APPLICATION_DOCUMENT_FILES)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  fileIds!: string[];
}
