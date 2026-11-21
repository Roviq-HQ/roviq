import { ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
  assertTenantContext,
  CurrentUser,
  GqlAuthGuard,
  InstituteScopeGuard,
} from '@roviq/auth-backend';
import type { AuthUser } from '@roviq/common-types';
import { RequestFileUploadInput } from '../../files/dto/request-file-upload.input';
import { FileService } from '../../files/file.service';
import { FileUploadTicket } from '../../files/models/file-upload-ticket.model';
import { StorageUsageModel } from '../../files/models/storage-usage.model';

// No @CheckAbility: the ability depends on the file purpose, so FileService checks it.
@UseGuards(GqlAuthGuard, InstituteScopeGuard)
@Resolver()
export class InstituteFileResolver {
  constructor(private readonly files: FileService) {}

  // Any member may see it: the number explains why their own upload was refused.
  @Query(() => StorageUsageModel, {
    description: "Storage used by the institute's files and the limit of its plan",
  })
  async storageUsage(@CurrentUser() user: AuthUser): Promise<StorageUsageModel> {
    assertTenantContext(user);
    return this.files.storageUsage(user);
  }

  @Mutation(() => FileUploadTicket, {
    description:
      'Start a file upload. Returns a URL that accepts one PUT of the declared size and type. The file is unusable until a mutation attaches it by `fileId`.',
  })
  async requestFileUpload(
    @CurrentUser() user: AuthUser,
    @Args('input') input: RequestFileUploadInput,
  ): Promise<FileUploadTicket> {
    assertTenantContext(user);
    return this.files.requestUpload(user, input);
  }

  @Mutation(() => String, {
    description:
      'Get a download URL for one file, valid for 60 seconds. A mutation, so every call is audited.',
  })
  async fileDownloadUrl(
    @CurrentUser() user: AuthUser,
    @Args('fileId', { type: () => ID }, ParseUUIDPipe) fileId: string,
  ): Promise<string> {
    assertTenantContext(user);
    return this.files.downloadUrl(user, fileId);
  }
}
