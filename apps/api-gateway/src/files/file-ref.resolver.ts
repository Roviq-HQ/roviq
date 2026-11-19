import { Args, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { ImageVariant } from '@roviq/common-types';
import { FileService } from './file.service';
import { FileRefModel } from './models/file-ref.model';
import type { FileRecord } from './repositories/types';

/**
 * Resolves `FileRef` from a file row. A resolver that exposes files returns the rows it is
 * allowed to show; the checks on who may see them belong there, not here.
 */
@Resolver(() => FileRefModel)
export class FileRefResolver {
  constructor(private readonly files: FileService) {}

  @ResolveField(() => String)
  name(@Parent() file: FileRecord): string {
    return file.originalName;
  }

  @ResolveField(() => String, { nullable: true })
  url(
    @Parent() file: FileRecord,
    @Args('variant', { type: () => ImageVariant, defaultValue: ImageVariant.FULL })
    variant: ImageVariant,
  ): Promise<string | null> {
    return this.files.refUrl(file, variant);
  }
}
