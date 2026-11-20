import { ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
  assertTenantContext,
  CurrentUser,
  GqlAuthGuard,
  InstituteScopeGuard,
} from '@roviq/auth-backend';
import {
  AbilityGuard,
  CheckAbility,
  CurrentReadAccess,
  type InstituteReadAccess,
} from '@roviq/casl';
import type { AuthUser } from '@roviq/common-types';
import { ApplicationDocumentService } from './application-document.service';
import { AddApplicationDocumentInput } from './dto/application-document.input';
import { ApplicationDocumentModel } from './models/application-document.model';

@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
@Resolver(() => ApplicationDocumentModel)
export class ApplicationDocumentResolver {
  constructor(private readonly documents: ApplicationDocumentService) {}

  @Query(() => [ApplicationDocumentModel], {
    description: 'Documents submitted with one admission application',
  })
  @CheckAbility({ action: 'read', subject: 'Application' })
  listApplicationDocuments(
    @Args('applicationId', { type: () => ID }, ParseUUIDPipe) applicationId: string,
    @CurrentReadAccess() access: InstituteReadAccess,
  ): Promise<ApplicationDocumentModel[]> {
    return this.documents.list(applicationId, access);
  }

  @Mutation(() => ApplicationDocumentModel, {
    description: 'Attach uploaded pages to an application as one document',
  })
  @CheckAbility({ action: 'update', subject: 'Application' })
  addApplicationDocument(
    @CurrentUser() user: AuthUser,
    @Args('input') input: AddApplicationDocumentInput,
  ): Promise<ApplicationDocumentModel> {
    assertTenantContext(user);
    return this.documents.add(user, input);
  }

  @Mutation(() => Boolean, { description: 'Remove a document and its files from an application' })
  @CheckAbility({ action: 'update', subject: 'Application' })
  async removeApplicationDocument(
    @CurrentUser() user: AuthUser,
    @Args('id', { type: () => ID }, ParseUUIDPipe) id: string,
  ): Promise<boolean> {
    assertTenantContext(user);
    await this.documents.remove(user, id);
    return true;
  }
}
