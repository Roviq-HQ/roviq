import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import type { AuthUser } from '@roviq/common-types';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { GraphQLJSON } from 'graphql-type-json';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { LoginResult } from '../auth/dto/auth-payload';
import { GqlAuthGuard } from '../auth/guards/gql-auth.guard';
import {
  GeneratePasskeyRegistrationInput,
  VerifyPasskeyAuthInput,
  VerifyPasskeyRegistrationInput,
} from './dto/passkey.input';
import { PasskeyAuthOptions, PasskeyInfo } from './dto/passkey-info.model';
import { PasskeyService } from './passkey.service';

@Resolver()
export class PasskeyResolver {
  constructor(private readonly passkeyService: PasskeyService) {}

  @Mutation(() => GraphQLJSON)
  @UseGuards(GqlAuthGuard)
  async generatePasskeyRegistrationOptions(
    @Args('input') input: GeneratePasskeyRegistrationInput,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    return this.passkeyService.generateRegistrationOptions(user.userId, input.password);
  }

  @Mutation(() => PasskeyInfo)
  @UseGuards(GqlAuthGuard)
  async verifyPasskeyRegistration(
    @Args('input') input: VerifyPasskeyRegistrationInput,
    @CurrentUser() user: AuthUser,
  ): Promise<PasskeyInfo> {
    return this.passkeyService.verifyRegistration(
      user.userId,
      input.credential as unknown as RegistrationResponseJSON,
      input.name,
    );
  }

  @Mutation(() => PasskeyAuthOptions)
  async generatePasskeyAuthOptions(
    @Args('username', { nullable: true }) username?: string,
  ): Promise<PasskeyAuthOptions> {
    return this.passkeyService.generateAuthOptions(username);
  }

  @Mutation(() => LoginResult)
  async verifyPasskeyAuth(@Args('input') input: VerifyPasskeyAuthInput): Promise<LoginResult> {
    return this.passkeyService.verifyAuth(
      input.challengeId,
      input.credential as unknown as AuthenticationResponseJSON,
    );
  }

  @Query(() => [PasskeyInfo])
  @UseGuards(GqlAuthGuard)
  async myPasskeys(@CurrentUser() user: AuthUser): Promise<PasskeyInfo[]> {
    return this.passkeyService.myPasskeys(user.userId);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async removePasskey(
    @Args('passkeyId') passkeyId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<boolean> {
    return this.passkeyService.removePasskey(user.userId, passkeyId);
  }
}
