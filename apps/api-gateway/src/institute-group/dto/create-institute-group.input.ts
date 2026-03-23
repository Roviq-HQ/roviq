import { Field, InputType } from '@nestjs/graphql';
import type { InstituteAddress, InstituteContact } from '@roviq/database';
import { IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, Matches } from 'class-validator';
import GraphQLJSON from 'graphql-type-json';
import { GroupTypeEnum } from '../models/institute-group.model';

@InputType()
export class CreateInstituteGroupInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, { message: 'code must be lowercase alphanumeric with hyphens' })
  code!: string;

  @Field(() => GroupTypeEnum)
  @IsEnum(GroupTypeEnum)
  type!: GroupTypeEnum;

  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  registrationNumber?: string;

  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  registrationState?: string;

  @Field(() => GraphQLJSON, { nullable: true })
  @IsObject()
  @IsOptional()
  contact?: InstituteContact;

  @Field(() => GraphQLJSON, { nullable: true })
  @IsObject()
  @IsOptional()
  address?: InstituteAddress;
}
