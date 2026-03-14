import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class PaymentGatewayConfigModel {
  @Field(() => ID)
  id!: string;

  @Field()
  organizationId!: string;

  @Field()
  provider!: string;

  @Field()
  isActive!: boolean;

  @Field()
  createdAt!: Date;
}
