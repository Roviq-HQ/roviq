import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import {
  assertResellerContext,
  CurrentUser,
  GqlAuthGuard,
  ResellerScopeGuard,
} from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import type { AuthUser } from '@roviq/common-types';
import { FileLoaders } from '../../files/file.loaders';
import { FileRefModel } from '../../files/models/file-ref.model';
import type { FileRecord } from '../../files/repositories/types';
import { ResellerUpdateBrandingInput } from './dto/reseller-update-branding.input';
import { ResellerUpdateProfileInput } from './dto/reseller-update-profile.input';
import { ResellerProfileModel } from './models/reseller-profile.model';
import { ResellerSettingsService } from './reseller-settings.service';

@UseGuards(GqlAuthGuard, ResellerScopeGuard, AbilityGuard)
@Resolver(() => ResellerProfileModel)
export class ResellerSettingsResolver {
  constructor(
    private readonly service: ResellerSettingsService,
    private readonly loaders: FileLoaders,
  ) {}

  @ResolveField(() => FileRefModel, {
    nullable: true,
    description: 'Logo. Ask for `url(variant: MD)` in headers.',
  })
  logo(@Parent() reseller: { logoFileId: string | null }): Promise<FileRecord | null> {
    return reseller.logoFileId
      ? this.loaders.readyById.load(reseller.logoFileId)
      : Promise.resolve(null);
  }

  @ResolveField(() => FileRefModel, {
    nullable: true,
    description: 'Browser-tab icon, stored square. Ask for `url(variant: SM)`.',
  })
  favicon(@Parent() reseller: { faviconFileId: string | null }): Promise<FileRecord | null> {
    return reseller.faviconFileId
      ? this.loaders.readyById.load(reseller.faviconFileId)
      : Promise.resolve(null);
  }

  @Query(() => ResellerProfileModel, {
    description:
      "The record of the reseller the caller works for: its name, registration, contact, address and branding. Not the caller's own account. Needs `read` on `Reseller`, which the full admin role holds; other team roles do not read it.",
  })
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
    description:
      "Edit the reseller's own logo, favicon, colours, colour scheme and extra stylesheet",
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
