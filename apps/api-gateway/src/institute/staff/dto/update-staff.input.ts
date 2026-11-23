import { Field, InputType, Int } from '@nestjs/graphql';
import { EmploymentType, Gender, SocialCategory } from '@roviq/common-types';
import type { I18nContent } from '@roviq/database';
import { I18nTextScalar } from '@roviq/nestjs-graphql';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

// Validator `message:` strings below are hardcoded English pending
// backend i18n (ROV-222). Once that lands, swap each to
// `i18nValidationMessage('validation.staff.*')`.

/**
 * Input for updating a staff member's personal and employment record. All content
 * fields are optional — only dirty fields are sent; `version` is required
 * and enforces optimistic concurrency in the service layer.
 *
 * Every property carries a class-validator decorator because the global
 * ValidationPipe runs with `forbidNonWhitelisted: true` — undecorated
 * properties are rejected as "should not exist".
 */
@InputType({ description: 'Input for updating staff member — optimistic concurrency via version' })
export class UpdateStaffInput {
  @Field(() => I18nTextScalar, {
    nullable: true,
    description: "First name as this institute records it. Changes the institute's copy only.",
  })
  @IsOptional()
  @IsObject()
  firstName?: I18nContent;

  @Field(() => I18nTextScalar, {
    nullable: true,
    description: 'Last name as this institute records it. Null removes it.',
  })
  @IsOptional()
  @IsObject()
  lastName?: I18nContent | null;

  @Field(() => Gender, { nullable: true })
  @IsOptional()
  @IsEnum(Gender, { message: 'gender must be one of: MALE, FEMALE, OTHER' })
  gender?: Gender;

  @Field(() => String, { nullable: true, description: 'Date of birth (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString({}, { message: 'dateOfBirth must be a valid ISO 8601 date string' })
  dateOfBirth?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  designation?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;

  @Field(() => EmploymentType, { nullable: true })
  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isClassTeacher?: boolean;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  specialization?: string;

  @Field(() => SocialCategory, { nullable: true })
  @IsOptional()
  @IsEnum(SocialCategory)
  socialCategory?: SocialCategory;

  @Field(() => Int, {
    description:
      'Current version the client read. The update fails with a ConflictException when the stored row has a higher version.',
  })
  @IsInt({ message: 'version must be an integer' })
  @Min(0, { message: 'version must be >= 0' })
  version!: number;
}
