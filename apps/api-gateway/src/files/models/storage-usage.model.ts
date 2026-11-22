import { Field, Float, ObjectType } from '@nestjs/graphql';

@ObjectType('StorageUsage', {
  description:
    "Storage taken by the institute's files and its members' files, against what its plan allows",
})
export class StorageUsageModel {
  @Field(() => Float, {
    description:
      'Bytes of files attached to records of the institute, plus documents and photos of its members. A person who belongs to several institutes counts in full for each.',
  })
  usedBytes!: number;

  @Field(() => Float, {
    nullable: true,
    description: 'Bytes the plan allows; null when the plan sets no limit',
  })
  limitBytes!: number | null;
}
