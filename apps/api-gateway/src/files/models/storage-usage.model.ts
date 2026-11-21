import { Field, Float, ObjectType } from '@nestjs/graphql';

@ObjectType('StorageUsage', {
  description: "Storage taken by the institute's own files, against what its plan allows",
})
export class StorageUsageModel {
  @Field(() => Float, {
    description:
      'Bytes of files attached to records of the institute. Files about a person (documents, photos) are not counted.',
  })
  usedBytes!: number;

  @Field(() => Float, {
    nullable: true,
    description: 'Bytes the plan allows; null when the plan sets no limit',
  })
  limitBytes!: number | null;
}
