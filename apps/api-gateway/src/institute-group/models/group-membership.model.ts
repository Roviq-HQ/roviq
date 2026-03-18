import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class GroupMembershipModel {
  @Field(() => ID)
  id!: string;

  @Field()
  userId!: string;

  @Field()
  groupId!: string;

  @Field()
  roleId!: string;

  @Field()
  isActive!: boolean;

  @Field(() => Date)
  createdAt!: Date;

  @Field(() => Date)
  updatedAt!: Date;
}
