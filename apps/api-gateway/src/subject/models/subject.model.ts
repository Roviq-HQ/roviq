import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';

export enum SubjectTypeEnum {
  ACADEMIC = 'ACADEMIC',
  LANGUAGE = 'LANGUAGE',
  SKILL = 'SKILL',
  EXTRACURRICULAR = 'EXTRACURRICULAR',
  INTERNAL_ASSESSMENT = 'INTERNAL_ASSESSMENT',
}

registerEnumType(SubjectTypeEnum, { name: 'SubjectType' });

@ObjectType()
export class SubjectModel {
  @Field(() => ID)
  id!: string;

  @Field()
  name!: string;

  @Field({ nullable: true })
  shortName?: string | null;

  @Field({ nullable: true })
  boardCode?: string | null;

  @Field(() => SubjectTypeEnum)
  type!: string;

  @Field()
  isMandatory!: boolean;

  @Field()
  hasPractical!: boolean;

  @Field(() => Int, { nullable: true })
  theoryMarks?: number | null;

  @Field(() => Int, { nullable: true })
  practicalMarks?: number | null;

  @Field(() => Int, { nullable: true })
  internalMarks?: number | null;

  @Field()
  isElective!: boolean;

  @Field({ nullable: true })
  electiveGroup?: string | null;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}
