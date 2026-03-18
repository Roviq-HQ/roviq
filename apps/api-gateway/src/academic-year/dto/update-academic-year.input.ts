import { Field, InputType } from '@nestjs/graphql';
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import GraphQLJSON from 'graphql-type-json';

@InputType()
export class UpdateAcademicYearInput {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  @Field({ nullable: true })
  label?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  @Field({ nullable: true })
  startDate?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  @Field({ nullable: true })
  endDate?: string;

  @IsArray()
  @IsOptional()
  @Field(() => GraphQLJSON, { nullable: true })
  termStructure?: unknown[];

  @IsOptional()
  @Field(() => GraphQLJSON, { nullable: true })
  boardExamDates?: Record<string, unknown>;
}
