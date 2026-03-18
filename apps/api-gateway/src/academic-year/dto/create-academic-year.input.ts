import { Field, InputType } from '@nestjs/graphql';
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import GraphQLJSON from 'graphql-type-json';

@InputType()
export class CreateAcademicYearInput {
  @IsString()
  @IsNotEmpty()
  @Field()
  label!: string;

  @IsString()
  @IsNotEmpty()
  @Field()
  startDate!: string;

  @IsString()
  @IsNotEmpty()
  @Field()
  endDate!: string;

  @IsArray()
  @IsOptional()
  @Field(() => GraphQLJSON, { nullable: true })
  termStructure?: unknown[];
}
