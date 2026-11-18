import { Field, ObjectType } from '@nestjs/graphql';
import type { I18nContent } from '@roviq/database';
import { I18nTextScalar } from '@roviq/nestjs-graphql';

@ObjectType()
export class StartImpersonationResult {
  /** One-time code (UUID) for token exchange — only present when no OTP is required. */
  @Field({ nullable: true })
  code?: string;

  /** True when the institute admin must approve via OTP before exchange. */
  @Field({ nullable: true })
  requiresOtp?: boolean;

  @Field({
    nullable: true,
    description:
      'Id of the pending OTP request, passed back to the verify-OTP mutation. The impersonation session itself is created only after the OTP is verified.',
  })
  sessionId?: string;
}

@ObjectType()
export class ImpersonationInstituteInfo {
  @Field()
  id!: string;

  @Field(() => I18nTextScalar)
  name!: I18nContent;
}

@ObjectType()
export class ImpersonationUserInfo {
  @Field()
  id!: string;

  @Field()
  username!: string;

  @Field(() => I18nTextScalar, {
    nullable: true,
    description: "The impersonated person's name, for the banner. Null without a profile.",
  })
  firstName!: I18nContent | null;

  @Field(() => I18nTextScalar, { nullable: true })
  lastName!: I18nContent | null;
}

@ObjectType()
export class ImpersonationAuthPayload {
  @Field()
  accessToken!: string;

  @Field(() => ImpersonationUserInfo)
  user!: ImpersonationUserInfo;

  @Field(() => ImpersonationInstituteInfo)
  institute!: ImpersonationInstituteInfo;
}
