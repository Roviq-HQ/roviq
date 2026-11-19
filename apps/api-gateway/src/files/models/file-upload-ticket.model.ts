import { Field, ID, ObjectType } from '@nestjs/graphql';
import { DateTimeScalar } from '@roviq/nestjs-graphql';

@ObjectType({ description: 'An HTTP header the browser must send with the upload.' })
export class FileUploadHeader {
  @Field(() => String)
  name!: string;

  @Field(() => String)
  value!: string;
}

@ObjectType({
  description:
    'Permission to upload one file. PUT the bytes to `uploadUrl` with `headers`, then pass `fileId` to the mutation that attaches it.',
})
export class FileUploadTicket {
  @Field(() => ID)
  fileId!: string;

  @Field(() => String, {
    description: 'Accepts one PUT of exactly the declared size and type before `expiresAt`.',
  })
  uploadUrl!: string;

  @Field(() => [FileUploadHeader])
  headers!: FileUploadHeader[];

  @Field(() => DateTimeScalar)
  expiresAt!: Date;
}
