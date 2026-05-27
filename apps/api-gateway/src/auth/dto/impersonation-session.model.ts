import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import type { I18nContent } from '@roviq/database';
import { DateTimeScalar, I18nTextScalar } from '@roviq/nestjs-graphql';

/** Lifecycle state of an impersonation session, derived from endedAt/expiresAt. */
export enum ImpersonationSessionStatus {
  ACTIVE = 'ACTIVE',
  ENDED = 'ENDED',
  EXPIRED = 'EXPIRED',
}

registerEnumType(ImpersonationSessionStatus, {
  name: 'ImpersonationSessionStatus',
  description: 'Lifecycle state of an impersonation session.',
});

/**
 * A read model of one row in `impersonation_sessions`, enriched with resolved display names
 * for the impersonator, the target user, the OTP verifier, and the target institute.
 * Powers the admin session-detail panel and the reseller impersonation-sessions page.
 */
@ObjectType()
export class ImpersonationSessionModel {
  @Field(() => ID)
  id!: string;

  @Field()
  impersonatorId!: string;

  /** 'platform' | 'reseller' | 'institute' */
  @Field()
  impersonatorScope!: string;

  @Field(() => String, { nullable: true })
  impersonatorName!: string | null;

  @Field()
  targetUserId!: string;

  @Field(() => String, { nullable: true })
  targetUserName!: string | null;

  @Field(() => String, { nullable: true })
  targetTenantId!: string | null;

  @Field(() => I18nTextScalar, { nullable: true })
  targetTenantName!: I18nContent | null;

  @Field()
  reason!: string;

  @Field(() => String, { nullable: true })
  ipAddress!: string | null;

  @Field(() => String, { nullable: true })
  userAgent!: string | null;

  @Field(() => DateTimeScalar)
  startedAt!: Date;

  @Field(() => DateTimeScalar)
  expiresAt!: Date;

  @Field(() => DateTimeScalar, { nullable: true })
  endedAt!: Date | null;

  @Field(() => String, { nullable: true })
  endedReason!: string | null;

  @Field(() => DateTimeScalar, { nullable: true })
  otpVerified!: Date | null;

  @Field(() => String, { nullable: true })
  otpVerifiedByName!: string | null;

  @Field(() => ImpersonationSessionStatus)
  status!: ImpersonationSessionStatus;
}
