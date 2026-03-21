import { Field, ObjectType } from '@nestjs/graphql';
import type { I18nContent } from '@roviq/database';
import { I18nTextScalar } from '@roviq/nestjs-graphql';

@ObjectType()
export class StartImpersonationResult {
  @Field()
  code!: string;

  @Field({ nullable: true })
  requiresOtp?: boolean;
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
