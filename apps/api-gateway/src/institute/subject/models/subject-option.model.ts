import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType({
  description:
    'A subject linked to a standard, reduced to label/dropdown identity. Batched alternative to one subjectsByStandard call per standard.',
})
export class SubjectOptionModel {
  @Field(() => ID)
  id!: string;

  @Field()
  name!: string;

  @Field(() => ID, { description: 'Standard this link belongs to — for client-side grouping.' })
  standardId!: string;
}
