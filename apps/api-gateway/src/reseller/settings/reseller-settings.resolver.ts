import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
  assertResellerContext,
  CurrentUser,
  GqlAuthGuard,
  ResellerScopeGuard,
} from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import type { AuthUser } from '@roviq/common-types';
import { ResellerUpdateBrandingInput } from './dto/reseller-update-branding.input';
import { ResellerUpdateProfileInput } from './dto/reseller-update-profile.input';
import { ResellerProfileModel } from './models/reseller-profile.model';
import { ResellerSettingsService } from './reseller-settings.service';

@UseGuards(GqlAuthGuard, ResellerScopeGuard, AbilityGuard)
@Resolver(() => ResellerProfileModel)
export class ResellerSettingsResolver {
  constructor(private readonly service: ResellerSettingsService) {}

  @Query(() => ResellerProfileModel, { description: "The signed-in reseller's own record" })
  @CheckAbility({ action: 'read', subject: 'Reseller' })
  async resellerMyProfile(@CurrentUser() user: AuthUser) {
    assertResellerContext(user);
    return this.service.getProfile(user);
  }

  @Mutation(() => ResellerProfileModel, {
    description: "Edit the reseller's own name, registration, contact and address",
  })
  @CheckAbility({ action: 'update', subject: 'Reseller' })
  async resellerUpdateProfile(
    @Args('input') input: ResellerUpdateProfileInput,
    @CurrentUser() user: AuthUser,
  ) {
    assertResellerContext(user);
    return this.service.updateProfile(user, input);
  }

  @Mutation(() => ResellerProfileModel, {
    description: "Edit the reseller's own colours, colour scheme and extra stylesheet",
  })
  @CheckAbility({ action: 'update', subject: 'Reseller' })
  async resellerUpdateBranding(
    @Args('input') input: ResellerUpdateBrandingInput,
    @CurrentUser() user: AuthUser,
  ) {
    assertResellerContext(user);
    return this.service.updateBranding(user, input);
  }
}
