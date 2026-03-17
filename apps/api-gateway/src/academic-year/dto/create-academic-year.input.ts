import { Field, InputType } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';

@InputType()
export class CreateAcademicYearInput {
  @Field()
  label!: string;

  @Field()
  startDate!: string;

  @Field()
  endDate!: string;

  @Field(() => GraphQLJSON, { nullable: true })
  termStructure?: unknown[];
}
