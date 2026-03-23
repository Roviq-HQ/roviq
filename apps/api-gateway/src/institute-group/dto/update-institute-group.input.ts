import { Field, InputType } from '@nestjs/graphql';
import type { InstituteAddress, InstituteContact } from '@roviq/database';
import { IsObject, IsOptional, IsString } from 'class-validator';
import GraphQLJSON from 'graphql-type-json';

@InputType()
export class UpdateInstituteGroupInput {
  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  name?: string;

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
