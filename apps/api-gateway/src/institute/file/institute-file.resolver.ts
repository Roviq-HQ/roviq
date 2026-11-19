import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Resolver } from '@nestjs/graphql';
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

// No @CheckAbility: the ability depends on the file purpose, so FileService checks it.
@UseGuards(GqlAuthGuard, InstituteScopeGuard)
@Resolver()
export class InstituteFileResolver {
  constructor(private readonly files: FileService) {}

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
    @Args('fileId', { type: () => ID }) fileId: string,
  ): Promise<string> {
    assertTenantContext(user);
    return this.files.downloadUrl(user, fileId);
  }
}
