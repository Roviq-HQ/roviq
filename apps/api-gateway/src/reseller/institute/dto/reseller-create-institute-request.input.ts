import { Field, InputType } from '@nestjs/graphql';
import { BoardType, EducationLevel, InstituteType, StructureFramework } from '@roviq/common-types';
import type { InstituteAddress, InstituteContact } from '@roviq/database';
import { I18nTextScalar } from '@roviq/nestjs-graphql';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';
import {
  InstituteAddressInput,
  InstituteContactInput,
} from '../../../institute/management/dto/create-institute.input';

@InputType({
  description: 'Fields required for a reseller to submit an institute creation request.',
})
export class ResellerCreateInstituteRequestInput {
  @Field(() => I18nTextScalar, {
    description:
      'Multilingual institute name, e.g. { "en": "Sunrise Academy", "hi": "सनराइज अकादमी" }.',
  })
  @IsObject()
  name!: Record<string, string>;

  @Field({
    description:
      'Unique URL-safe slug — lowercase alphanumerics and hyphens, e.g. "sunrise-academy".',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, { message: 'slug must be lowercase alphanumeric with hyphens' })
  slug!: string;

  @Field(() => String, {
    nullable: true,
    description: 'Short internal code for the institute, e.g. "SA-JDH".',
  })
  @IsString()
  @IsOptional()
  code?: string;

  @Field(() => InstituteType, {
    nullable: true,
    defaultValue: 'SCHOOL',
    description: 'Kind of institute (school, coaching or library). Defaults to SCHOOL.',
  })
  @IsEnum(InstituteType)
  @IsOptional()
  type?: InstituteType;

  @Field(() => StructureFramework, {
    nullable: true,
    defaultValue: 'TRADITIONAL',
    description: 'Curriculum structure framework. Defaults to TRADITIONAL.',
  })
  @IsEnum(StructureFramework)
  @IsOptional()
  structureFramework?: StructureFramework;

  @Field(() => InstituteContactInput, {
    nullable: true,
    description: 'Primary contact details for the institute.',
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
    description: 'Education departments offered, e.g. [PRIMARY, SECONDARY].',
  })
  @IsArray()
  @IsEnum(EducationLevel, { each: true })
  @IsOptional()
  departments?: EducationLevel[];

  @Field(() => BoardType, {
    nullable: true,
    description: 'Affiliated board, e.g. CBSE or RBSE.',
  })
  @IsEnum(BoardType)
  @IsOptional()
  board?: BoardType;

  @Field(() => String, {
    nullable: true,
    description: 'ID of the institute group (trust/chain/society) this institute belongs to.',
  })
  @IsUUID()
  @IsOptional()
  groupId?: string;
}
