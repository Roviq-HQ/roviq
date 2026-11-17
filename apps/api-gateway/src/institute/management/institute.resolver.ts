import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
  assertTenantContext,
  CurrentUser,
  GqlAuthGuard,
  InstituteScopeGuard,
} from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import type { AuthUser } from '@roviq/common-types';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import { CreateInstituteInput } from './dto/create-institute.input';
import { InstituteFilterInput } from './dto/institute-filter.input';
import { UpdateInstituteBrandingInput } from './dto/update-institute-branding.input';
import { UpdateInstituteConfigInput } from './dto/update-institute-config.input';
import { UpdateInstituteInfoInput } from './dto/update-institute-info.input';
import { UpdateInstituteLocalesInput } from './dto/update-institute-locales.input';
import { InstituteService } from './institute.service';
import { InstituteModel } from './models/institute.model';
import { InstituteConnection } from './models/institute-connection.model';

@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
@Resolver(() => InstituteModel)
export class InstituteResolver {
  constructor(private readonly instituteService: InstituteService) {}

  @Query(() => InstituteConnection)
  @CheckAbility({ action: 'read', subject: 'Institute' })
  async institutes(@Args('filter', { nullable: true }) filter?: InstituteFilterInput) {
    return this.instituteService.search(filter ?? {});
  }

  @Query(() => InstituteModel)
  @CheckAbility({ action: 'read', subject: 'Institute' })
  async institute(@Args('id', { type: () => ID }) id: string) {
    return this.instituteService.findById(id);
  }

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
  @CheckAbility({ action: 'create', subject: 'Institute' })
  async createInstitute(@Args('input') input: CreateInstituteInput) {
    return this.instituteService.create(input);
  }

  @Mutation(() => InstituteModel)
  @CheckAbility({ action: 'update_info', subject: 'Institute' })
  async updateInstituteInfo(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateInstituteInfoInput,
  ) {
    return this.instituteService.updateInfo(id, input);
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

  @Mutation(() => InstituteModel)
  @CheckAbility({ action: 'activate', subject: 'Institute' })
  async activateInstitute(@Args('id', { type: () => ID }) id: string) {
    return this.instituteService.activate(id);
  }

  @Mutation(() => InstituteModel)
  @CheckAbility({ action: 'deactivate', subject: 'Institute' })
  async deactivateInstitute(@Args('id', { type: () => ID }) id: string) {
    return this.instituteService.deactivate(id);
  }

  @Mutation(() => InstituteModel)
  @CheckAbility({ action: 'suspend', subject: 'Institute' })
  async suspendInstitute(@Args('id', { type: () => ID }) id: string) {
    return this.instituteService.suspend(id);
  }

  @Mutation(() => InstituteModel)
  @CheckAbility({ action: 'reject', subject: 'Institute' })
  async rejectInstitute(@Args('id', { type: () => ID }) id: string) {
    return this.instituteService.reject(id);
  }

  @Mutation(() => Boolean)
  @CheckAbility({ action: 'delete', subject: 'Institute' })
  async deleteInstitute(@Args('id', { type: () => ID }) id: string) {
    return this.instituteService.delete(id);
  }

  @Mutation(() => InstituteModel)
  @CheckAbility({ action: 'restore', subject: 'Institute' })
  async restoreInstitute(@Args('id', { type: () => ID }) id: string) {
    return this.instituteService.restore(id);
  }
}
