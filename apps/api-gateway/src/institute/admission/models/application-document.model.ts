import { Field, ID, ObjectType } from '@nestjs/graphql';
import { UserDocumentType } from '@roviq/common-types';
import { DateTimeScalar } from '@roviq/nestjs-graphql';
import { FileRefModel } from '../../../files/models/file-ref.model';
import type { FileRecord } from '../../../files/repositories/types';

@ObjectType({ description: 'A document submitted with an admission application' })
export class ApplicationDocumentModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  applicationId!: string;

  @Field(() => UserDocumentType)
  type!: UserDocumentType;

  @Field(() => [FileRefModel], {
    description:
      'Pages of the document, in order. Their `url` is null: download each with `fileDownloadUrl`.',
  })
  files!: FileRecord[];

  @Field(() => DateTimeScalar)
  createdAt!: Date;
}
