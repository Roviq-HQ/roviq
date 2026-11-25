import { Field, ID, InputType } from '@nestjs/graphql';
import { IsEnum, IsUUID } from 'class-validator';
import { ConsentPurpose } from './consent.enums';

@InputType({
  description: 'Input for withdrawing parental consent for a specific data processing purpose',
})
export class WithdrawConsentInput {
  @Field(() => ID, { description: 'The student profile to withdraw consent for' })
  @IsUUID('7', { message: 'studentProfileId must be a valid UUIDv7' })
  studentProfileId!: string;

  @Field(() => ConsentPurpose, { description: 'The purpose to withdraw consent for' })
  @IsEnum(ConsentPurpose)
  purpose!: ConsentPurpose;
}
