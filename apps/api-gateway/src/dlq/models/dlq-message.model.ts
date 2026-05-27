/**
 * Platform-admin GraphQL surface for the dead-letter queue reader (ROV-19).
 * Mirrors the `dlq_messages` Drizzle table; the DLQ status enum is registered
 * with NestJS GraphQL so the SDL surfaces it as a first-class type.
 */
import { Field, ID, InputType, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import type { DlqStatus } from '@roviq/common-types';
import { DateTimeScalar } from '@roviq/nestjs-graphql';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import GraphQLJSON from 'graphql-type-json';
import { createConnectionType } from '../../common/pagination/relay-pagination.model';

/**
 * Lifecycle of a dead-lettered message — guarded by `DLQ_STATE_MACHINE`:
 * - `pending`: persisted, awaiting admin action
 * - `replayed`: re-published to its original subject
 * - `discarded`: dropped without replay
 */
export enum DlqStatusEnum {
  PENDING = 'pending',
  REPLAYED = 'replayed',
  DISCARDED = 'discarded',
}

// Compile-time lock: enum values must stay equal to the DlqStatus union.
const _dlqStatusValuesMatch: DlqStatus = DlqStatusEnum.PENDING;
void _dlqStatusValuesMatch;

registerEnumType(DlqStatusEnum, {
  name: 'DlqStatus',
  description: 'Lifecycle state of a dead-lettered NATS message',
});

@ObjectType({ description: 'Platform-admin view of a dead-lettered NATS message' })
export class DlqMessageModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { description: 'Original NATS subject the message failed on' })
  originalSubject!: string;

  @Field(() => String, {
    description: "First subject segment (e.g. 'NOTIFICATION') — filter facet",
  })
  originStream!: string;

  @Field(() => GraphQLJSON, { nullable: true, description: 'Original message payload (JSONB)' })
  payload?: unknown;

  @Field(() => String, { description: 'Error message that triggered the dead-letter' })
  error!: string;

  @Field(() => Int, { description: 'Delivery attempts before dead-lettering' })
  retryCount!: number;

  @Field(() => String, { description: 'Correlation id carried from the original message' })
  correlationId!: string;

  @Field(() => ID, {
    nullable: true,
    description: 'Tenant the message belonged to; null if cross-tenant',
  })
  tenantId?: string | null;

  @Field(() => DateTimeScalar, { description: 'When the message was dead-lettered' })
  failedAt!: Date;

  @Field(() => DlqStatusEnum)
  status!: DlqStatusEnum;

  @Field(() => DateTimeScalar, {
    nullable: true,
    description: 'When the message was last replayed',
  })
  replayedAt?: Date | null;

  @Field(() => Int, { description: 'Number of times this message has been replayed' })
  replayCount!: number;
}

@InputType({ description: 'Filters + cursor pagination for the DLQ message list' })
export class DlqMessageFilterInput {
  @Field(() => String, { nullable: true, description: 'Filter by origin stream prefix' })
  @IsOptional()
  @IsString()
  originStream?: string;

  @Field(() => DlqStatusEnum, { nullable: true, description: 'Filter by lifecycle status' })
  @IsOptional()
  @IsEnum(DlqStatusEnum)
  status?: DlqStatusEnum;

  @Field(() => ID, { nullable: true, description: 'Filter by tenant id' })
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @Field(() => Int, { nullable: true, description: 'Page size (max 100, default 25)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  first?: number;

  @Field(() => String, { nullable: true, description: 'Opaque cursor from a previous page' })
  @IsOptional()
  @IsString()
  after?: string;
}

export const { ConnectionType: DlqMessageConnection, EdgeType: DlqMessageEdge } =
  createConnectionType(DlqMessageModel, 'DlqMessage');
