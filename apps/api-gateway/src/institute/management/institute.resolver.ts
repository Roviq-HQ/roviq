import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
  assertTenantContext,
  CurrentUser,
  GqlAuthGuard,
  InstituteScopeGuard,
} from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import type { AuthUser } from '@roviq/common-types';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import { UpdateInstituteBrandingInput } from './dto/update-institute-branding.input';
import { UpdateInstituteConfigInput } from './dto/update-institute-config.input';
import { UpdateInstituteInfoInput } from './dto/update-institute-info.input';
import { UpdateInstituteLocalesInput } from './dto/update-institute-locales.input';
import { InstituteService } from './institute.service';
import { InstituteModel } from './models/institute.model';

// SECURITY: no handler here may take an institute id — the repository runs as admin, so an id
// argument lets one institute act on another (ROV-290). Use the token tenant; platform-level
// operations belong in admin/.
@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
@Resolver(() => InstituteModel)
export class InstituteResolver {
  constructor(private readonly instituteService: InstituteService) {}

  @Query(() => InstituteModel)
  @CheckAbility({ action: 'read', subject: 'Institute' })
  async myInstitute(@CurrentUser() user: AuthUser) {
    assertTenantContext(user);
    if (!user.tenantId) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        'Institute scope required to access myInstitute',
      );
    }
    return this.instituteService.findById(user.tenantId);
  }

  @Mutation(() => InstituteModel)
  @CheckAbility({ action: 'update_info', subject: 'Institute' })
  async updateInstituteInfo(
    @CurrentUser() user: AuthUser,
    @Args('input') input: UpdateInstituteInfoInput,
  ) {
    assertTenantContext(user);
    return this.instituteService.updateInfo(user.tenantId, input);
  }

  @Mutation(() => InstituteModel)
  @CheckAbility({ action: 'update_branding', subject: 'Institute' })
  async updateInstituteBranding(
    @CurrentUser() user: AuthUser,
    @Args('input') input: UpdateInstituteBrandingInput,
  ) {
    assertTenantContext(user);
    return this.instituteService.updateBranding(user.tenantId, input);
  }

  @Mutation(() => InstituteModel)
  @CheckAbility({ action: 'update_config', subject: 'Institute' })
  async updateInstituteLocales(
    @CurrentUser() user: AuthUser,
    @Args('input') input: UpdateInstituteLocalesInput,
  ) {
    assertTenantContext(user);
    return this.instituteService.updateLocales(user.tenantId, input);
  }

  @Mutation(() => InstituteModel)
  @CheckAbility({ action: 'update_config', subject: 'Institute' })
  async updateInstituteConfig(
    @CurrentUser() user: AuthUser,
    @Args('input') input: UpdateInstituteConfigInput,
  ) {
    assertTenantContext(user);
    return this.instituteService.updateConfig(user.tenantId, input);
  }
}
