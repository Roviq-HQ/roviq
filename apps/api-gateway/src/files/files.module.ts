import { Module } from '@nestjs/common';
import { FileService } from './file.service';
import { FileRepositoryModule } from './repositories/file-repository.module';

@Module({
  imports: [FileRepositoryModule],
  providers: [FileService],
  exports: [FileService],
})
export class FilesModule {}
