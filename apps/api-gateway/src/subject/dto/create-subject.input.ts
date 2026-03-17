import { Field, ID, InputType, Int } from '@nestjs/graphql';
import { SubjectTypeEnum } from '../models/subject.model';

@InputType()
export class CreateSubjectInput {
  @Field()
  name!: string;

  @Field({ nullable: true })
  shortName?: string;

  @Field({ nullable: true })
  boardCode?: string;

  @Field(() => SubjectTypeEnum, { nullable: true, defaultValue: 'ACADEMIC' })
  type?: string;

  @Field({ nullable: true, defaultValue: false })
  isMandatory?: boolean;

  @Field({ nullable: true, defaultValue: false })
  hasPractical?: boolean;

  @Field(() => Int, { nullable: true })
  theoryMarks?: number;

  @Field(() => Int, { nullable: true })
  practicalMarks?: number;

  @Field(() => Int, { nullable: true })
  internalMarks?: number;

  @Field({ nullable: true, defaultValue: false })
  isElective?: boolean;

  @Field({ nullable: true })
  electiveGroup?: string;

  @Field(() => [ID], { nullable: true })
  standardIds?: string[];

  @Field(() => [ID], { nullable: true })
  sectionIds?: string[];
}
