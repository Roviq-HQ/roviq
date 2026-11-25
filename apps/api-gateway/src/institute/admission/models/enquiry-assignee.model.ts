import { Field, ID, ObjectType } from '@nestjs/graphql';
import type { I18nContent } from '@roviq/database';
import { I18nTextScalar } from '@roviq/nestjs-graphql';

@ObjectType({
  description: 'The staff member an enquiry is assigned to, as this institute knows them',
})
export class EnquiryAssigneeModel {
  @Field(() => ID, { description: "User id, the same as the enquiry's `assignedTo`" })
  userId!: string;

  @Field(() => I18nTextScalar, {
    description: "First name (i18n) from the institute's profile copy",
  })
  firstName!: I18nContent;

  @Field(() => I18nTextScalar, { nullable: true, description: 'Last name (i18n)' })
  lastName!: I18nContent | null;

  @Field(() => String, {
    nullable: true,
    description: 'Employee id, to tell apart staff with the same name; null when none was set',
  })
  employeeId!: string | null;
}
