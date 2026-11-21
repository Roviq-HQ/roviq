import { ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
  assertTenantContext,
  CurrentUser,
  GqlAuthGuard,
  InstituteScopeGuard,
} from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import type { AuthUser } from '@roviq/common-types';
import { CertificateService } from './certificate.service';
import { ListTCFilterInput, RequestDuplicateTCInput, RequestTCInput } from './dto/request-tc.input';
import { TCModel } from './models/tc.model';

@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
@Resolver(() => TCModel)
export class TCResolver {
  constructor(private readonly certService: CertificateService) {}

  @Mutation(() => TCModel, {
    description: 'Request a Transfer Certificate — starts TCIssuanceWorkflow',
  })
  @CheckAbility({ action: 'create', subject: 'TC' })
  async requestTC(
    @Args('input') input: RequestTCInput,
    @CurrentUser() user: AuthUser,
  ): Promise<TCModel> {
    assertTenantContext(user);
    return this.certService.requestTC(user, input);
  }

  @Mutation(() => TCModel, { description: 'Approve a TC (principal only)' })
  @CheckAbility({ action: 'manage', subject: 'TC' })
  async approveTC(
    @Args('id', { type: () => ID }, ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<TCModel> {
    assertTenantContext(user);
    return this.certService.approveTC(user, id);
  }

  @Mutation(() => TCModel, { description: 'Reject a transfer certificate request' })
  @CheckAbility({ action: 'manage', subject: 'TC' })
  async rejectTC(
    @Args('id', { type: () => ID }, ParseUUIDPipe) id: string,
    @Args('reason') reason: string,
    @CurrentUser() user: AuthUser,
  ): Promise<TCModel> {
    assertTenantContext(user);
    return this.certService.rejectTC(user, id, reason);
  }

  @Mutation(() => TCModel, {
    description: 'Issue TC — generates serial, PDF, marks student transferred_out',
  })
  @CheckAbility({ action: 'manage', subject: 'TC' })
  async issueTC(
    @Args('id', { type: () => ID }, ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<TCModel> {
    assertTenantContext(user);
    return this.certService.issueTC(user, id);
  }

  @Query(() => TCModel, { description: 'Get TC details including 20-field CBSE data snapshot' })
  @CheckAbility({ action: 'read', subject: 'TC' })
  async getTCDetails(
    @Args('id', { type: () => ID }, ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<TCModel> {
    assertTenantContext(user);
    return this.certService.getTCDetails(user, id);
  }

  @Query(() => [TCModel], { description: 'List TCs with optional filters' })
  @CheckAbility({ action: 'read', subject: 'TC' })
  async listTCs(
    @CurrentUser() user: AuthUser,
    @Args('filter', { nullable: true }) filter?: ListTCFilterInput,
  ): Promise<TCModel[]> {
    assertTenantContext(user);
    return this.certService.listTCs(user, filter);
  }

  @Mutation(() => TCModel, {
    description: 'Request duplicate TC (PRD §5.3) — is_duplicate=true, references original',
  })
  @CheckAbility({ action: 'create', subject: 'TC' })
  async requestDuplicateTC(
    @Args('input') input: RequestDuplicateTCInput,
    @CurrentUser() user: AuthUser,
  ): Promise<TCModel> {
    assertTenantContext(user);
    return this.certService.requestDuplicateTC(user, {
      originalTcId: input.originalTcId,
      reason: input.reason,
      duplicateFee: input.duplicateFee ? BigInt(input.duplicateFee) : undefined,
    });
  }
}
