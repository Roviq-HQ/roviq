import { UseGuards } from '@nestjs/common';
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser, GqlAuthGuard } from '@roviq/auth-backend';
import type { AuthUser } from '@roviq/common-types';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server';
import { GraphQLJSON } from 'graphql-type-json';
import { InstituteLoginResult } from '../auth/dto/auth-payload';
import { extractMeta, type GqlContext } from '../auth/gql-context';
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

  /** GraphQLJSON is intentional — returns an opaque WebAuthn PublicKeyCredentialCreationOptionsJSON
   *  blob that the client passes directly to navigator.credentials.create() without inspecting fields. */
  @Mutation(() => GraphQLJSON)
  @UseGuards(GqlAuthGuard)
  async generatePasskeyRegistrationOptions(
    @Args('input') input: GeneratePasskeyRegistrationInput,
    @CurrentUser() user: AuthUser,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    return this.passkeyService.generateRegistrationOptions(user, input.password);
  }

  @Mutation(() => PasskeyInfo)
  @UseGuards(GqlAuthGuard)
  async verifyPasskeyRegistration(
    @Args('input') input: VerifyPasskeyRegistrationInput,
    @CurrentUser() user: AuthUser,
  ): Promise<PasskeyInfo> {
    return this.passkeyService.verifyRegistration(user, input.credential, input.name);
  }

  @Mutation(() => PasskeyAuthOptions)
  async generatePasskeyAuthOptions(
    @Args('username', { nullable: true }) username?: string,
  ): Promise<PasskeyAuthOptions> {
    return this.passkeyService.generateAuthOptions(username);
  }

  @Mutation(() => InstituteLoginResult)
  async verifyPasskeyAuth(
    @Args('input') input: VerifyPasskeyAuthInput,
    @Context() ctx: GqlContext,
  ): Promise<InstituteLoginResult> {
    return this.passkeyService.verifyAuth(input.challengeId, input.credential, extractMeta(ctx));
  }

  @Query(() => [PasskeyInfo])
  @UseGuards(GqlAuthGuard)
  async myPasskeys(@CurrentUser() user: AuthUser): Promise<PasskeyInfo[]> {
    return this.passkeyService.myPasskeys(user);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async removePasskey(
    @Args('passkeyId') passkeyId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<boolean> {
    return this.passkeyService.removePasskey(user, passkeyId);
  }
}
