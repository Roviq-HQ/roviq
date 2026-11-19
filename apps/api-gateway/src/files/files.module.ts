import { Module } from '@nestjs/common';
import { FileService } from './file.service';
import { FileRefResolver } from './file-ref.resolver';
import { ImageProcessor } from './image/image-processor';
import { SharpImageProcessor } from './image/sharp-image-processor';
import { FileRepositoryModule } from './repositories/file-repository.module';

@Module({
  imports: [FileRepositoryModule],
  providers: [
    FileService,
    FileRefResolver,
    { provide: ImageProcessor, useClass: SharpImageProcessor },
  ],
  exports: [FileService],
})
export class FilesModule {}
