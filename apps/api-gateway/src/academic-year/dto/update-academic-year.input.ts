import { Field, InputType } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';

@InputType()
export class UpdateAcademicYearInput {
  @Field({ nullable: true })
  label?: string;

  @Field({ nullable: true })
  startDate?: string;

  @Field({ nullable: true })
  endDate?: string;

  @Field(() => GraphQLJSON, { nullable: true })
  termStructure?: unknown[];

  @Field(() => GraphQLJSON, { nullable: true })
  boardExamDates?: Record<string, unknown>;
}
