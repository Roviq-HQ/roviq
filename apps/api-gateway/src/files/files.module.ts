import { Logger, Module } from '@nestjs/common';
import { DRIZZLE_DB, type DrizzleDB } from '@roviq/database';
import { StorageClient } from '@roviq/storage';
import { FileLoaders } from './file.loaders';
import { FileService } from './file.service';
import { FilePurgeRepository } from './file-purge.repository';
import { FileRefResolver } from './file-ref.resolver';
import { FileSweeper } from './file-sweeper';
import { ImageProcessor } from './image/image-processor';
import { SharpImageProcessor } from './image/sharp-image-processor';
import { ProfilePhotoService } from './profile-photo.service';
import { FileRepositoryModule } from './repositories/file-repository.module';
import { FileSweeperWorkerService } from './workflows/file-sweeper.worker';

@Module({
  imports: [FileRepositoryModule],
  providers: [
    FileService,
    FileLoaders,
    ProfilePhotoService,
    FileRefResolver,
    { provide: ImageProcessor, useClass: SharpImageProcessor },
    {
      provide: FilePurgeRepository,
      inject: [DRIZZLE_DB],
      useFactory: (db: DrizzleDB) => new FilePurgeRepository(db, 'workflow:file-sweeper'),
    },
    {
      provide: FileSweeper,
      inject: [FilePurgeRepository, StorageClient],
      useFactory: (repo: FilePurgeRepository, storage: StorageClient) =>
        new FileSweeper(repo, storage, new Logger(FileSweeper.name)),
    },
    FileSweeperWorkerService,
  ],
  exports: [FileService, FileLoaders, ProfilePhotoService],
})
export class FilesModule {}
