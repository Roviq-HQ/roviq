import { Field, InputType, Int } from '@nestjs/graphql';
import { IsArray, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import {
  InstituteStatusEnum,
  InstituteTypeEnum,
} from '../../../institute/management/models/institute.model';

@InputType()
export class AdminListInstitutesFilterInput {
  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  search?: string;

  @Field(() => [InstituteStatusEnum], { nullable: true })
  @IsArray()
  @IsEnum(InstituteStatusEnum, { each: true })
  @IsOptional()
  status?: InstituteStatusEnum[];

  @Field(() => InstituteTypeEnum, { nullable: true })
  @IsEnum(InstituteTypeEnum)
  @IsOptional()
  type?: InstituteTypeEnum;

  @Field({ nullable: true })
  @IsUUID()
  @IsOptional()
  resellerId?: string;

  @Field({ nullable: true })
  @IsUUID()
  @IsOptional()
  groupId?: string;

  @Field(() => Int, { nullable: true, defaultValue: 20 })
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  first?: number;

  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  after?: string;
}
