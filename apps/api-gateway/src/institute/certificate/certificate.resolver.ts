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
import { PreviewCertificateInput } from './dto/preview-certificate.input';
import { ListCertificateFilterInput, RequestCertificateInput } from './dto/request-tc.input';
import { CertificateModel } from './models/tc.model';

@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
@Resolver(() => CertificateModel)
export class CertificateResolver {
  constructor(private readonly certService: CertificateService) {}

  @Mutation(() => CertificateModel, {
    description: 'Request a certificate from template — auto-populates fields',
  })
  @CheckAbility({ action: 'create', subject: 'Certificate' })
  async requestCertificate(
    @Args('input') input: RequestCertificateInput,
    @CurrentUser() user: AuthUser,
  ): Promise<CertificateModel> {
    assertTenantContext(user);
    return this.certService.requestCertificate(user, input);
  }

  @Mutation(() => CertificateModel, {
    description: 'Render the PDF of an issued certificate that has none',
  })
  @CheckAbility({ action: 'manage', subject: 'Certificate' })
  async generateCertificatePdf(
    @Args('id', { type: () => ID }, ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<CertificateModel> {
    assertTenantContext(user);
    return this.certService.generateCertificatePdf(user, id);
  }

  @Mutation(() => CertificateModel, {
    description: 'Issue certificate — generates serial, renders PDF',
  })
  @CheckAbility({ action: 'manage', subject: 'Certificate' })
  async issueCertificate(
    @Args('id', { type: () => ID }, ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<CertificateModel> {
    assertTenantContext(user);
    return this.certService.issueCertificate(user, id);
  }

  @Query(() => [CertificateModel], { description: 'List certificates with optional filters' })
  @CheckAbility({ action: 'read', subject: 'Certificate' })
  async listCertificates(
    @CurrentUser() user: AuthUser,
    @Args('filter', { nullable: true }) filter?: ListCertificateFilterInput,
  ): Promise<CertificateModel[]> {
    assertTenantContext(user);
    return this.certService.listCertificates(user, filter);
  }

  @Query(() => CertificateModel, { description: 'Get a certificate by id' })
  @CheckAbility({ action: 'read', subject: 'Certificate' })
  async getCertificate(
    @Args('id', { type: () => ID }, ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<CertificateModel> {
    assertTenantContext(user);
    return this.certService.findCertificateById(user, id);
  }

  @Query(() => [String], {
    description:
      'Placeholder field names for a certificate template (auto-populate driver for the Issue Certificate dialog).',
  })
  @CheckAbility({ action: 'read', subject: 'Certificate' })
  async getCertificateTemplateFields(
    @Args('templateId', { type: () => ID }, ParseUUIDPipe) templateId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<string[]> {
    assertTenantContext(user);
    return this.certService.getCertificateTemplateFields(user, templateId);
  }

  @Query(() => String, {
    description:
      'Renders a preview HTML for a certificate by substituting student data into the template. No row is persisted.',
  })
  @CheckAbility({ action: 'read', subject: 'Certificate' })
  async previewCertificate(
    @Args('input') input: PreviewCertificateInput,
    @CurrentUser() user: AuthUser,
  ): Promise<string> {
    assertTenantContext(user);
    return this.certService.previewCertificate(user, input);
  }
}
