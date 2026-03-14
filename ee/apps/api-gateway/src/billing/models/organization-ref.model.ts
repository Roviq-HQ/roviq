import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class OrganizationRef {
  @Field(() => ID)
  id!: string;

  @Field()
  name!: string;
}
