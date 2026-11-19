import { Field, InputType, Int } from '@nestjs/graphql';
import { IndianState } from '@roviq/common-types';
import type { InstituteAddress, InstituteContact } from '@roviq/database';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  InstituteAddressInput,
  InstituteContactInput,
} from '../../../institute/management/dto/create-institute.input';

@InputType({
  description:
    'Payload for resellerUpdateProfile. An omitted field is left as it is. Slug, tier and custom domain are platform-only.',
})
export class ResellerUpdateProfileInput {
  @Field(() => Int, {
    description: 'Optimistic concurrency version — must match the current server value',
  })
  @IsInt()
  version!: number;

  @Field(() => String, { nullable: true })
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(255)
  name?: string | null;

  @Field(() => String, { nullable: true, description: 'Pass null to clear' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  registrationNumber?: string | null;

  @Field(() => IndianState, { nullable: true, description: 'Pass null to clear' })
  @IsEnum(IndianState)
  @IsOptional()
  registrationState?: IndianState | null;

  @Field(() => InstituteContactInput, { nullable: true })
  @IsObject()
  @IsOptional()
  contact?: InstituteContact | null;

  @Field(() => InstituteAddressInput, { nullable: true, description: 'Pass null to clear' })
  @IsObject()
  @IsOptional()
  address?: InstituteAddress | null;
}
