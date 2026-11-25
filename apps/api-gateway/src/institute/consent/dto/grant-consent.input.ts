import { Field, ID, InputType } from '@nestjs/graphql';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ConsentPurpose, ConsentVerificationMethod } from './consent.enums';

@InputType({
  description: 'Input for granting parental consent for a specific data processing purpose',
})
export class GrantConsentInput {
  @Field(() => ID, { description: 'The student profile to grant consent for' })
  @IsUUID('7', { message: 'studentProfileId must be a valid UUIDv7' })
  studentProfileId!: string;

  @Field(() => ConsentPurpose)
  @IsEnum(ConsentPurpose)
  purpose!: ConsentPurpose;

  @Field(() => ConsentVerificationMethod, { nullable: true })
  @IsOptional()
  @IsEnum(ConsentVerificationMethod)
  verificationMethod?: ConsentVerificationMethod;
}
