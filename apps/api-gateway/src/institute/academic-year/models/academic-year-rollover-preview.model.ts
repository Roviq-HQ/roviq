import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import type { I18nContent } from '@roviq/database';
import { I18nTextScalar } from '@roviq/nestjs-graphql';

@ObjectType({
  description: 'A section of the year being activated and what the rollover would add to it.',
})
export class RolloverSectionLoad {
  @Field(() => ID)
  sectionId!: string;

  @Field(() => ID)
  standardId!: string;

  @Field(() => I18nTextScalar)
  standardName!: I18nContent;

  @Field(() => I18nTextScalar)
  sectionName!: I18nContent;

  @Field(() => Int, { description: 'Students already in the section.' })
  currentStrength!: number;

  @Field(() => Int, { description: 'Students the rollover would place in the section.' })
  incoming!: number;

  @Field(() => Int, {
    description:
      "The institute's hard limit per section. The section is over it when currentStrength + incoming is greater. The rollover places the students anyway.",
  })
  capacity!: number;
}

@ObjectType({
  description:
    'Students of one section of the active year who would go to one section of the year being activated.',
})
export class RolloverSectionMove {
  @Field(() => ID)
  fromSectionId!: string;

  @Field(() => I18nTextScalar)
  fromStandardName!: I18nContent;

  @Field(() => I18nTextScalar)
  fromSectionName!: I18nContent;

  @Field(() => ID, {
    nullable: true,
    description: "Null when the students' class does not exist in the year being activated.",
  })
  toStandardId!: string | null;

  @Field(() => ID, {
    nullable: true,
    description: 'Null when that class has no section: these students would not be placed.',
  })
  toSectionId!: string | null;

  @Field(() => Int)
  students!: number;

  @Field({ description: 'The target section was chosen with setRolloverSectionMap.' })
  overridden!: boolean;
}

@ObjectType({
  description:
    'What activating an academic year would do to the students of the currently active year. All zero when no year is active.',
})
export class AcademicYearRolloverPreview {
  @Field(() => Int, { description: 'Students placed in a higher class than last year.' })
  movingUp!: number;

  @Field(() => Int, { description: 'Students placed in the same class as last year.' })
  staying!: number;

  @Field(() => Int, {
    description: 'Students in the highest class with no recorded result: no place in the new year.',
  })
  completing!: number;

  @Field(() => Int, { description: 'Students recorded as GRADUATED or TRANSFERRED.' })
  notCarried!: number;

  @Field(() => Int, {
    description: 'Students whose class in the new year has no standard or no section yet.',
  })
  noClassInNewYear!: number;

  @Field(() => Int, { description: 'Students who already have a record in the new year.' })
  alreadyPlaced!: number;

  @Field(() => [RolloverSectionLoad], {
    description: 'Every section of the year being activated, in class order.',
  })
  sections!: RolloverSectionLoad[];

  @Field(() => [RolloverSectionMove], {
    description:
      'One line per source section and target section, source sections in class order, the largest group of a section first.',
  })
  moves!: RolloverSectionMove[];
}
