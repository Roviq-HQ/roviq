import { Module } from '@nestjs/common';
import { FileLoaders } from './file.loaders';
import { FileService } from './file.service';
import { FileRefResolver } from './file-ref.resolver';
import { ImageProcessor } from './image/image-processor';
import { SharpImageProcessor } from './image/sharp-image-processor';
import { ProfilePhotoService } from './profile-photo.service';
import { FileRepositoryModule } from './repositories/file-repository.module';

@Module({
  imports: [FileRepositoryModule],
  providers: [
    FileService,
    FileLoaders,
    ProfilePhotoService,
    FileRefResolver,
    { provide: ImageProcessor, useClass: SharpImageProcessor },
  ],
  exports: [FileService, FileLoaders, ProfilePhotoService],
})
export class FilesModule {}
