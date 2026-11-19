import { Field, Float, ID, ObjectType } from '@nestjs/graphql';

@ObjectType('FileRef', {
  description: 'A stored file. `url` is signed when the response is built and expires.',
})
export class FileRefModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { description: 'File name as the uploader had it; display only.' })
  name!: string;

  @Field(() => String, { description: 'Verified MIME type.' })
  contentType!: string;

  @Field(() => Float, { description: 'Size in bytes.' })
  sizeBytes!: number;

  @Field(() => String, {
    nullable: true,
    description:
      'Download URL, valid for about 10 minutes. Null for sensitive files: call `fileDownloadUrl` instead.',
  })
  url!: string | null;
}
