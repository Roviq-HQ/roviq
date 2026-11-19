import { Field, Float, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import { ImageVariant } from '@roviq/common-types';

registerEnumType(ImageVariant, {
  name: 'ImageVariant',
  description: 'Stored size of an image: SM (128 px), MD (512 px) or FULL.',
});

@ObjectType('FileRef', {
  description: 'A stored file. `url` is signed when the response is built and expires.',
})
export class FileRefModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { description: 'File name as the uploader had it; display only.' })
  name!: string;

  @Field(() => String, {
    description: 'Verified MIME type. Every image is stored as `image/webp`.',
  })
  contentType!: string;

  @Field(() => Float, { description: 'Size in bytes; for an image, all stored sizes together.' })
  sizeBytes!: number;

  @Field(() => String, {
    nullable: true,
    description:
      'Download URL. For an image, `variant` picks the size; SM and MD links stay the same for hours so browsers can cache them. Null for sensitive files: call `fileDownloadUrl` instead.',
  })
  url!: string | null;

  @Field(() => Int, { nullable: true, description: 'Pixel width of the FULL size; images only.' })
  width!: number | null;

  @Field(() => Int, { nullable: true, description: 'Pixel height of the FULL size; images only.' })
  height!: number | null;

  @Field(() => String, {
    nullable: true,
    description: 'Tiny blurred preview as a data URI, to show while the image loads; images only.',
  })
  placeholder!: string | null;
}
