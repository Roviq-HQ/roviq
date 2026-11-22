import { ArgsType, Field } from '@nestjs/graphql';
import { AuditMask } from '@roviq/audit';
import { IsString } from 'class-validator';

@ArgsType()
export class ChangePasswordArgs {
  @Field(() => String)
  @IsString()
  @AuditMask()
  currentPassword!: string;

  @Field(() => String)
  @IsString()
  @AuditMask()
  newPassword!: string;
}
