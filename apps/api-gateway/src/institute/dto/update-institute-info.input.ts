import { Field, InputType } from '@nestjs/graphql';
import type { InstituteAddress, InstituteContact } from '@roviq/database';
import GraphQLJSON from 'graphql-type-json';

@InputType()
export class UpdateInstituteInfoInput {
  @Field(() => GraphQLJSON, { nullable: true })
  name?: Record<string, string>;

  @Field({ nullable: true })
  code?: string;

  @Field(() => GraphQLJSON, { nullable: true })
  contact?: InstituteContact;

  @Field(() => GraphQLJSON, { nullable: true })
  address?: InstituteAddress;

  @Field({ nullable: true })
  timezone?: string;

  @Field({ nullable: true })
  currency?: string;
}
