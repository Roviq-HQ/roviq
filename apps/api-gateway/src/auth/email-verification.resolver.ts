import { UseGuards } from '@nestjs/common';
import { Args, Field, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { NoAudit } from '@roviq/audit';
import { CurrentUser, GqlAuthGuard } from '@roviq/auth-backend';
import type { AuthUser } from '@roviq/common-types';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import { EmailVerificationService } from './email-verification.service';

@ObjectType({
  description: "Whether the signed-in user has proved they read their account's email",
})
export class EmailVerificationModel {
  @Field()
  email!: string;

  @Field(() => Boolean, {
    description:
      'An account with an unverified email cannot be given a role by email (first admin, reseller team) by anyone but the person who created it.',
  })
  isVerified!: boolean;
}

// Impersonation must never verify an address on someone else's behalf.
function assertOwnSession(user: AuthUser): void {
  if (user.isImpersonated) {
    throw new BusinessException(
      ErrorCode.FORBIDDEN,
      'Email verification is not available while impersonating',
    );
  }
}

@UseGuards(GqlAuthGuard)
@Resolver(() => EmailVerificationModel)
export class EmailVerificationResolver {
  constructor(private readonly verifications: EmailVerificationService) {}

  @Query(() => EmailVerificationModel, {
    description: "The signed-in user's email address and whether it is verified.",
  })
  myEmailVerification(@CurrentUser() user: AuthUser): Promise<EmailVerificationModel> {
    return this.verifications.state(user);
  }

  @Mutation(() => Boolean, {
    description:
      'Send a 6-digit code to the account email. Valid for 10 minutes; a new one can be requested after 60 seconds.',
  })
  async requestEmailVerification(@CurrentUser() user: AuthUser): Promise<boolean> {
    assertOwnSession(user);
    await this.verifications.request(user);
    return true;
  }

  @NoAudit()
  @Mutation(() => Boolean, {
    description: 'Confirm the code sent by `requestEmailVerification`.',
  })
  async verifyEmail(@CurrentUser() user: AuthUser, @Args('code') code: string): Promise<boolean> {
    assertOwnSession(user);
    await this.verifications.verify(user, code);
    return true;
  }
}
