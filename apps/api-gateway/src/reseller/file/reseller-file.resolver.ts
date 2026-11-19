import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import {
  assertResellerContext,
  CurrentUser,
  GqlAuthGuard,
  ResellerScopeGuard,
} from '@roviq/auth-backend';
import type { AuthUser } from '@roviq/common-types';
import { RequestFileUploadInput } from '../../files/dto/request-file-upload.input';
import { FileService } from '../../files/file.service';
import { FileUploadTicket } from '../../files/models/file-upload-ticket.model';

// No @CheckAbility: the ability depends on the file purpose, so FileService checks it.
@UseGuards(GqlAuthGuard, ResellerScopeGuard)
@Resolver()
export class ResellerFileResolver {
  constructor(private readonly files: FileService) {}

  @Mutation(() => FileUploadTicket, {
    description:
      "Start an upload of one of the reseller's own files (its logo or favicon). Returns a URL that accepts one PUT of the declared size and type. The file is unusable until a mutation attaches it by `fileId`.",
  })
  async resellerRequestFileUpload(
    @CurrentUser() user: AuthUser,
    @Args('input') input: RequestFileUploadInput,
  ): Promise<FileUploadTicket> {
    assertResellerContext(user);
    return this.files.requestUpload(user, input);
  }
}
