import { Field, ID, ObjectType } from '@nestjs/graphql';
import { I18nTextScalar } from '@roviq/nestjs-graphql';

@ObjectType({
  description:
    'A staff member reduced to assignment identity: id plus display name. Served to roles with Timetable read (e.g. teachers) that must label grids and assignment dropdowns without Staff-directory access.',
})
export class TeacherOptionModel {
  @Field(() => ID, { description: 'Staff membership id — matches timetable entry teacherId.' })
  membershipId!: string;

  @Field(() => I18nTextScalar)
  firstName!: Record<string, string>;

  @Field(() => I18nTextScalar, { nullable: true })
  lastName?: Record<string, string> | null;
}
