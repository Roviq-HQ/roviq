import { Field, ID, ObjectType } from '@nestjs/graphql';
import type { I18nContent } from '@roviq/database';
import { DateTimeScalar, I18nTextScalar } from '@roviq/nestjs-graphql';

@ObjectType({
  description:
    'A soft-deleted student, staff member or guardian, as shown in the Deleted list. Restore it with the matching restore mutation.',
})
export class DeletedPersonModel {
  @Field(() => ID, { description: 'Profile id — pass it to the restore mutation.' })
  id!: string;

  @Field(() => I18nTextScalar)
  firstName!: I18nContent;

  @Field(() => I18nTextScalar, { nullable: true })
  lastName?: I18nContent | null;

  @Field(() => String, {
    nullable: true,
    description: 'Admission number for a student, employee id for staff, null for a guardian.',
  })
  identifier?: string | null;

  @Field(() => DateTimeScalar, { description: 'When the record was deleted.' })
  deletedAt!: Date;
}
