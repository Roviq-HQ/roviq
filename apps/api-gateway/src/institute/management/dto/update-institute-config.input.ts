import { Field, InputType } from '@nestjs/graphql';
import { IsArray, IsObject, IsOptional, IsString } from 'class-validator';
import GraphQLJSON from 'graphql-type-json';

@InputType()
export class UpdateInstituteConfigInput {
  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  attendanceType?: string;

  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  openingTime?: string;

  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  closingTime?: string;

  @Field(() => GraphQLJSON, { nullable: true })
  @IsArray()
  @IsOptional()
  shifts?: Record<string, unknown>[];

  @Field(() => GraphQLJSON, { nullable: true })
  @IsObject()
  @IsOptional()
  notificationPreferences?: Record<string, unknown>;

  @Field(() => GraphQLJSON, { nullable: true })
  @IsObject()
  @IsOptional()
  payrollConfig?: Record<string, unknown>;

  @Field(() => GraphQLJSON, { nullable: true })
  @IsObject()
  @IsOptional()
  gradingSystem?: Record<string, unknown>;

  @Field(() => GraphQLJSON, { nullable: true })
  @IsArray()
  @IsOptional()
  termStructure?: Record<string, unknown>[];

  @Field(() => GraphQLJSON, { nullable: true })
  @IsObject()
  @IsOptional()
  sectionStrengthNorms?: Record<string, unknown>;
}
