import { Field, InputType, Int } from '@nestjs/graphql';
import { SubjectTypeEnum } from '../models/subject.model';

@InputType()
export class UpdateSubjectInput {
  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  shortName?: string;

  @Field({ nullable: true })
  boardCode?: string;

  @Field(() => SubjectTypeEnum, { nullable: true })
  type?: string;

  @Field({ nullable: true })
  isMandatory?: boolean;

  @Field({ nullable: true })
  hasPractical?: boolean;

  @Field(() => Int, { nullable: true })
  theoryMarks?: number;

  @Field(() => Int, { nullable: true })
  practicalMarks?: number;

  @Field(() => Int, { nullable: true })
  internalMarks?: number;

  @Field({ nullable: true })
  isElective?: boolean;

  @Field({ nullable: true })
  electiveGroup?: string;
}
