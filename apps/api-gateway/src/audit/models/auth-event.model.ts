import { Field, ID, ObjectType } from '@nestjs/graphql';
import { DateTimeScalar } from '@roviq/nestjs-graphql';
import { GraphQLJSON } from 'graphql-type-json';

@ObjectType()
export class AuthEventModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  userId?: string | null;

  @Field()
  eventType!: string;

  @Field(() => String, {
    nullable: true,
    description:
      'Portal the request came through (platform, reseller, institute). Set on every sign-in attempt, successful or not.',
  })
  portal?: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'Scope of the session that was granted. Null for a refused attempt.',
  })
  scope?: string | null;

  @Field(() => String, { nullable: true })
  tenantId?: string | null;

  @Field(() => String, { nullable: true })
  resellerId?: string | null;

  @Field(() => String, {
    nullable: true,
    description:
      'Membership of the session, in the membership table of `scope`. Null when there was no session.',
  })
  membershipId?: string | null;

  @Field(() => String, { nullable: true })
  authMethod?: string | null;

  @Field(() => String, { nullable: true })
  ipAddress?: string | null;

  @Field(() => String, { nullable: true })
  userAgent?: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'AuthFailureReason code. Internal detail the sign-in response never reveals.',
  })
  failureReason?: string | null;

  @Field(() => GraphQLJSON, { nullable: true })
  metadata?: Record<string, unknown> | null;

  @Field(() => DateTimeScalar)
  createdAt!: Date;
}
