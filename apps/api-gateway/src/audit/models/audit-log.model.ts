import { Field, ID, ObjectType } from '@nestjs/graphql';
import type { I18nContent } from '@roviq/database';
import { DateTimeScalar, I18nTextScalar } from '@roviq/nestjs-graphql';
import { GraphQLJSON } from 'graphql-type-json';

@ObjectType()
export class AuditLog {
  @Field(() => ID)
  id!: string;

  /** NULL for platform and reseller-scoped actions */
  @Field(() => String, { nullable: true })
  tenantId!: string | null;

  @Field()
  userId!: string;

  @Field()
  actorId!: string;

  @Field(() => String, { nullable: true })
  impersonatorId!: string | null;

  /** FK to impersonation_sessions — set only for rows written during impersonation. */
  @Field(() => String, { nullable: true })
  impersonationSessionId!: string | null;

  @Field()
  action!: string;

  @Field()
  actionType!: string;

  @Field()
  entityType!: string;

  @Field(() => String, { nullable: true })
  entityId!: string | null;

  @Field(() => GraphQLJSON, { nullable: true })
  changes!: Record<string, unknown> | null;

  @Field(() => GraphQLJSON, { nullable: true })
  metadata!: Record<string, unknown> | null;

  @Field()
  correlationId!: string;

  @Field(() => String, { nullable: true })
  ipAddress!: string | null;

  @Field(() => String, { nullable: true })
  userAgent!: string | null;

  @Field()
  source!: string;

  /** Tags rows written by the synthetic-user actor with their originating workflow / consumer / seeder. NULL for normal JWT-driven requests. */
  @Field(() => String, { nullable: true })
  syntheticOrigin!: string | null;

  @Field(() => DateTimeScalar)
  createdAt!: Date;

  @Field(() => String, { nullable: true })
  actorName!: string | null;

  @Field(() => String, { nullable: true })
  userName!: string | null;

  @Field(() => I18nTextScalar, { nullable: true })
  tenantName!: I18nContent | null;

  /** Reseller display name (joined on resellers.id). Null for non-reseller-scoped entries. */
  @Field(() => String, { nullable: true })
  resellerName!: string | null;

  /** Reseller tier (FULL_MANAGEMENT / SUPPORT_MANAGEMENT / READ_ONLY). Null when no reseller. */
  @Field(() => String, { nullable: true })
  resellerTier!: string | null;
}
