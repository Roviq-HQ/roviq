/**
 * Input for `adminUpdateReseller` (ROV-234). Slug is immutable (changing it breaks
 * URLs) and tier has its own mutation because it cascades to memberships.
 */
import { Field, InputType, Int } from '@nestjs/graphql';
import { IndianState } from '@roviq/common-types';
import type { InstituteAddress, InstituteContact } from '@roviq/database';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsFQDN,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  InstituteAddressInput,
  InstituteContactInput,
} from '../../../institute/management/dto/create-institute.input';
import { AdminResellerBrandingInput } from './admin-create-reseller.input';

@InputType({
  description: 'Payload for adminUpdateReseller — slug and tier are not updatable here',
})
export class AdminUpdateResellerInput {
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

  @Field(() => AdminResellerBrandingInput, { nullable: true })
  @ValidateNested()
  @Type(() => AdminResellerBrandingInput)
  @IsOptional()
  branding?: AdminResellerBrandingInput | null;

  @Field(() => String, { nullable: true, description: 'Pass null to clear the custom domain' })
  @IsFQDN({ require_tld: true })
  @IsOptional()
  @MaxLength(255)
  customDomain?: string | null;

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
