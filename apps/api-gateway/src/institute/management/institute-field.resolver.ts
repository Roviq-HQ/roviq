/**
 * Scope-agnostic field resolvers for `InstituteModel`.
 *
 * These `@ResolveField` handlers run for whichever scope fetched the parent
 * institute. Reseller and platform parents come only from queries already
 * scoped to that caller; an institute caller may only resolve its own.
 */
import { UseGuards } from '@nestjs/common';
import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { CurrentUser, GqlAuthGuard } from '@roviq/auth-backend';
import type { AuthUser } from '@roviq/common-types';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import { InstituteService } from './institute.service';
import { InstituteModel } from './models/institute.model';
import { InstituteAffiliationModel } from './models/institute-affiliation.model';
import { InstituteBrandingModel } from './models/institute-branding.model';
import { InstituteConfigModel } from './models/institute-config.model';
import { InstituteIdentifierModel } from './models/institute-identifier.model';

@UseGuards(GqlAuthGuard)
@Resolver(() => InstituteModel)
export class InstituteFieldResolver {
  constructor(private readonly instituteService: InstituteService) {}

  @ResolveField(() => InstituteBrandingModel, { nullable: true })
  async branding(@Parent() institute: { id: string }, @CurrentUser() user: AuthUser) {
    assertReadable(user, institute.id);
    return this.instituteService.findBranding(institute.id);
  }

  @ResolveField(() => InstituteConfigModel, { nullable: true })
  async config(@Parent() institute: { id: string }, @CurrentUser() user: AuthUser) {
    assertReadable(user, institute.id);
    return this.instituteService.findConfig(institute.id);
  }

  @ResolveField(() => [InstituteIdentifierModel], { nullable: true })
  async identifiers(@Parent() institute: { id: string }, @CurrentUser() user: AuthUser) {
    assertReadable(user, institute.id);
    return this.instituteService.findIdentifiers(institute.id);
  }

  @ResolveField(() => [InstituteAffiliationModel], { nullable: true })
  async affiliations(@Parent() institute: { id: string }, @CurrentUser() user: AuthUser) {
    assertReadable(user, institute.id);
    return this.instituteService.findAffiliations(institute.id);
  }
}

function assertReadable(user: AuthUser, instituteId: string): void {
  if (user.scope === 'institute' && user.tenantId !== instituteId) {
    throw new BusinessException(ErrorCode.FORBIDDEN, 'Institute not accessible');
  }
}
