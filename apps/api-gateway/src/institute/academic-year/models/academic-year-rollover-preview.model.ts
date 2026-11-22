import { Field, Int, ObjectType } from '@nestjs/graphql';

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
}
