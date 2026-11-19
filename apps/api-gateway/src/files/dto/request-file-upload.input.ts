import { Field, InputType, Int, registerEnumType } from '@nestjs/graphql';
import { FilePurpose } from '@roviq/common-types';
import { IsEnum, IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';

registerEnumType(FilePurpose, {
  name: 'FilePurpose',
  description: 'What a file is uploaded for. Decides allowed types, size limit and visibility.',
});

@InputType({ description: 'Ask for permission to upload one file.' })
export class RequestFileUploadInput {
  @IsEnum(FilePurpose)
  @Field(() => FilePurpose)
  purpose!: FilePurpose;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Field(() => String, { description: 'File name on the device, e.g. "certificate.pdf".' })
  fileName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Field(() => String, { description: 'MIME type of the file, e.g. "application/pdf".' })
  contentType!: string;

  @IsInt()
  @Min(1)
  @Field(() => Int, {
    description: 'Exact size in bytes. Storage rejects an upload of any other size.',
  })
  sizeBytes!: number;
}
