import { Field, Float, InputType } from '@nestjs/graphql';
import { BoardType, EducationLevel, InstituteType, StructureFramework } from '@roviq/common-types';
import type { InstituteAddress, InstituteContact } from '@roviq/database';
import { I18nTextScalar } from '@roviq/nestjs-graphql';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

@InputType({
  description:
    'The person who becomes the institute admin. Matched to a Roviq account by email when the institute is requested or created (an existing account is reused unchanged, otherwise one is created); setup gives that account access and, if it has never logged in, sends its login details by email/SMS. INSTITUTE_ADMIN_UNAVAILABLE when the email cannot identify one live account.',
})
export class InstituteFirstAdminInput {
  @Field({ description: 'First name, shown on the account and in the welcome message.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @Field(() => String, { nullable: true, description: 'Last name.' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  lastName?: string;

  @Field({
    description:
      'Email address, trimmed and lower-cased; matches an existing Roviq account case-insensitively.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @Field(() => String, {
    nullable: true,
    description: '10-digit Indian mobile number without +91; set only on a newly created account.',
  })
  @IsOptional()
  @Matches(/^\d{10}$/, { message: 'phone must be exactly 10 digits' })
  phone?: string;
}

// ── Contact / Address input types ──

@InputType({ description: 'A single phone number entry for the institute contact.' })
export class InstitutePhoneInput {
  @Field({ description: 'ITU-T E.164 country code, e.g. "+91" for India.' })
  countryCode!: string;

  @Field({ description: 'Local phone number without country code.' })
  number!: string;

  @Field({ description: 'Whether this is the main/primary contact number.' })
  isPrimary!: boolean;

  @Field({
    description: 'Whether WhatsApp is active on this number — used for parent communication.',
  })
  isWhatsappEnabled!: boolean;

  @Field({ description: 'Human-readable label, e.g. "Office", "Principal", "Admissions".' })
  label!: string;
}

@InputType({ description: 'A single email address entry for the institute contact.' })
export class InstituteEmailInput {
  @Field({ description: 'RFC-5322 email address.' })
  address!: string;

  @Field({ description: 'Whether this is the primary email for official correspondence.' })
  isPrimary!: boolean;

  @Field({ description: 'Human-readable label, e.g. "General", "Admissions", "Finance".' })
  label!: string;
}

@InputType({ description: 'Combined phone and email contact details for the institute.' })
export class InstituteContactInput {
  @Field(() => [InstitutePhoneInput], {
    description: 'List of phone numbers. At least one should be marked isPrimary.',
  })
  phones!: InstitutePhoneInput[];

  @Field(() => [InstituteEmailInput], {
    description: 'List of email addresses. At least one should be marked isPrimary.',
  })
  emails!: InstituteEmailInput[];
}

@InputType({ description: 'Geographic coordinates (WGS 84) for the institute location.' })
export class CoordinatesInput {
  @Field(() => Float, { description: 'Latitude in decimal degrees (−90 to +90).' })
  lat!: number;

  @Field(() => Float, { description: 'Longitude in decimal degrees (−180 to +180).' })
  lng!: number;
}

@InputType({ description: 'Physical address of the institute.' })
export class InstituteAddressInput {
  @Field({ description: 'First line of street address, e.g. building name or plot number.' })
  line1!: string;

  @Field({ nullable: true, description: 'Second address line, e.g. sector or locality name.' })
  line2?: string;

  @Field({ nullable: true, description: 'Third address line (optional additional detail).' })
  line3?: string;

  @Field({ description: 'City or town name.' })
  city!: string;

  @Field({ description: 'District name (used for government reporting and UDISE+).' })
  district!: string;

  @Field({ description: 'State name, e.g. "Rajasthan" or "Haryana".' })
  state!: string;

  @Field({ description: 'PIN code (6-digit Indian postal code).' })
  postalCode!: string;

  @Field({ description: 'Country name, e.g. "India".' })
  country!: string;

  @Field(() => CoordinatesInput, {
    nullable: true,
    description: 'WGS 84 coordinates — used for distance-based RTE verification.',
  })
  coordinates?: CoordinatesInput;
}

// ── Main input ──

@InputType({
  description: 'Fields required to create a new institute. Slug must be globally unique.',
})
export class CreateInstituteInput {
  @Field(() => I18nTextScalar, {
    description: 'Localised institute name, e.g. { en: "Sunrise Academy", hi: "सनराइज़ अकैडमी" }.',
  })
  @IsObject()
  name!: Record<string, string>;

  @Field({
    description:
      'URL-safe slug — globally unique, lowercase alphanumerics and hyphens only, e.g. "sunrise-academy-jaipur".',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, { message: 'slug must be lowercase alphanumeric with hyphens' })
  slug!: string;

  @Field({
    nullable: true,
    description: 'Short internal code for the institute, e.g. "SAJ". Unique per reseller.',
  })
  @IsString()
  @IsOptional()
  code?: string;

  @Field(() => InstituteType, {
    nullable: true,
    defaultValue: 'SCHOOL',
    description: 'Type of educational institution.',
  })
  @IsEnum(InstituteType)
  @IsOptional()
  type?: InstituteType;

  @Field(() => StructureFramework, {
    nullable: true,
    defaultValue: 'TRADITIONAL',
    description: 'Academic structure — NEP 2020 (5+3+3+4 stages) or legacy 10+2.',
  })
  @IsEnum(StructureFramework)
  @IsOptional()
  structureFramework?: StructureFramework;

  @Field(() => InstituteContactInput, {
    nullable: true,
    description: 'Phone and email contact details.',
  })
  @IsObject()
  @IsOptional()
  contact?: InstituteContact;

  @Field(() => InstituteAddressInput, {
    nullable: true,
    description: 'Physical address of the institute.',
  })
  @IsObject()
  @IsOptional()
  address?: InstituteAddress;

  @Field(() => [EducationLevel], {
    nullable: true,
    description: 'Education levels offered, e.g. ["PRIMARY", "UPPER_PRIMARY"].',
  })
  @IsArray()
  @IsEnum(EducationLevel, { each: true })
  @IsOptional()
  departments?: EducationLevel[];

  @Field(() => BoardType, { nullable: true })
  @IsEnum(BoardType)
  @IsOptional()
  board?: BoardType;

  @Field({
    nullable: true,
    defaultValue: false,
    description: 'Whether this is a demo/sandbox institute — excludes it from production reports.',
  })
  @IsBoolean()
  @IsOptional()
  isDemo?: boolean;

  @Field(() => InstituteFirstAdminInput, {
    description: 'The person setup makes the institute admin.',
  })
  @ValidateNested()
  @Type(() => InstituteFirstAdminInput)
  firstAdmin!: InstituteFirstAdminInput;
}
