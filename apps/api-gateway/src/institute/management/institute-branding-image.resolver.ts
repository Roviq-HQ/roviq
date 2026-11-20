import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { FileLoaders } from '../../files/file.loaders';
import { FileRefModel } from '../../files/models/file-ref.model';
import type { FileRecord } from '../../files/repositories/types';
import { InstituteBrandingModel } from './models/institute-branding.model';

/** Branding images, loaded as the caller's own database role. Their links are public. */
@Resolver(() => InstituteBrandingModel)
export class InstituteBrandingImageResolver {
  constructor(private readonly loaders: FileLoaders) {}

  @ResolveField(() => FileRefModel, {
    nullable: true,
    description: 'Logo shown in the portal header. Ask for `url(variant: MD)`.',
  })
  logo(@Parent() branding: InstituteBrandingModel): Promise<FileRecord | null> {
    return this.load(branding.logoFileId);
  }

  @ResolveField(() => FileRefModel, { nullable: true, description: 'Browser-tab icon.' })
  favicon(@Parent() branding: InstituteBrandingModel): Promise<FileRecord | null> {
    return this.load(branding.faviconFileId);
  }

  @ResolveField(() => FileRefModel, {
    nullable: true,
    description: 'Banner shown on the login page.',
  })
  coverImage(@Parent() branding: InstituteBrandingModel): Promise<FileRecord | null> {
    return this.load(branding.coverImageFileId);
  }

  private load(fileId: string | null | undefined): Promise<FileRecord | null> {
    return fileId ? this.loaders.readyById.load(fileId) : Promise.resolve(null);
  }
}
