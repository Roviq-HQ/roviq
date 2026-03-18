import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';

export enum AcademicYearStatusEnum {
  PLANNING = 'PLANNING',
  ACTIVE = 'ACTIVE',
  COMPLETING = 'COMPLETING',
  ARCHIVED = 'ARCHIVED',
}

registerEnumType(AcademicYearStatusEnum, { name: 'AcademicYearStatus' });

@ObjectType()
export class AcademicYearModel {
  @Field(() => ID)
  id!: string;

  @Field()
  label!: string;

  @Field()
  startDate!: string;

  @Field()
  endDate!: string;

  @Field()
  isActive!: boolean;

  @Field(() => AcademicYearStatusEnum)
  status!: AcademicYearStatusEnum;

  @Field(() => GraphQLJSON, { nullable: true })
  termStructure?: unknown[];

  @Field(() => GraphQLJSON, { nullable: true })
  boardExamDates?: Record<string, unknown>;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}
