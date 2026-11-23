import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import { EmploymentType, Gender, SocialCategory } from '@roviq/common-types';
import type { I18nContent } from '@roviq/database';
import { DateOnlyScalar, DateTimeScalar, I18nTextScalar } from '@roviq/nestjs-graphql';
import { SignInStatus } from '../../sign-in-details/sign-in-status.enum';

registerEnumType(EmploymentType, {
  name: 'EmploymentType',
  description: 'Staff employment arrangement with the institute.',
});

@ObjectType({ description: 'Staff member profile with employment details' })
export class StaffModel {
  @Field(() => ID)
  id!: string;

  @Field()
  userId!: string;

  @Field()
  membershipId!: string;

  // ── Personal (joined from tenant_user_profiles) ───────────
  /**
   * First name resolved from the institute's `tenant_user_profiles` copy. Required by the staff list
   * page (rov-169) which displays "Name" as a primary column. Cannot be
   * null because every staff member gets the institute's profile copy on staff
   * creation.
   */
  /** Multilingual via i18nText; resolved via useI18nField() on the frontend. */
  @Field(() => I18nTextScalar)
  firstName!: I18nContent;

  /** Multilingual via i18nText; resolved via useI18nField() on the frontend. */
  @Field(() => I18nTextScalar, { nullable: true })
  lastName?: I18nContent | null;

  @Field(() => Gender, { nullable: true })
  gender?: Gender | null;

  @Field(() => DateOnlyScalar, { nullable: true })
  dateOfBirth?: string | null;

  /** Not a GraphQL field: `profileImage` is resolved from it (profileImageResolverFor). */
  profileImageFileId?: string | null;

  @Field(() => String, { nullable: true, description: 'Institute-assigned employee ID' })
  employeeId?: string | null;

  @Field(() => String, { nullable: true })
  designation?: string | null;

  @Field(() => String, { nullable: true })
  department?: string | null;

  @Field(() => DateOnlyScalar, { nullable: true })
  dateOfJoining?: string | null;

  @Field(() => DateOnlyScalar, { nullable: true })
  dateOfLeaving?: string | null;

  @Field(() => EmploymentType, { nullable: true })
  employmentType?: EmploymentType | null;

  @Field(() => Boolean)
  isClassTeacher!: boolean;

  @Field(() => SocialCategory, { nullable: true })
  socialCategory?: SocialCategory | null;

  @Field(() => String, { nullable: true })
  specialization?: string | null;

  @Field(() => DateTimeScalar)
  createdAt!: Date;

  @Field(() => DateTimeScalar)
  updatedAt!: Date;

  /**
   * Row version used for optimistic concurrency on `updateStaffMember`.
   * Exposed so the profile edit form can submit `input.version` for the
   * compare-and-swap update — see `staff.service.ts#update` and rov-169.
   */
  @Field(() => Int)
  version!: number;

  @Field(() => SignInStatus, {
    description: 'Where this person stands with their first sign-in, as this institute sees it.',
  })
  signInStatus!: SignInStatus;

  @Field(() => DateTimeScalar, {
    nullable: true,
    description:
      'When the latest sign-in details reached the email or SMS provider; null if never.',
  })
  signInDetailsSentAt?: Date | null;
}

@ObjectType({ description: 'Staff statistics by department' })
export class StaffStatistics {
  @Field(() => Int)
  total!: number;

  @Field(() => Int)
  active!: number;

  @Field(() => Int)
  classTeachers!: number;

  @Field(() => [DepartmentCount])
  byDepartment!: DepartmentCount[];
}

@ObjectType()
export class DepartmentCount {
  @Field()
  department!: string;

  @Field(() => Int)
  count!: number;
}
