import { Module } from '@nestjs/common';
import { FileDrizzleRepository } from './file.drizzle-repository';
import { FileRepository } from './file.repository';
import { ProfilePhotoDrizzleRepository } from './profile-photo.drizzle-repository';
import { ProfilePhotoRepository } from './profile-photo.repository';

@Module({
  providers: [
    { provide: FileRepository, useClass: FileDrizzleRepository },
    { provide: ProfilePhotoRepository, useClass: ProfilePhotoDrizzleRepository },
  ],
  exports: [FileRepository, ProfilePhotoRepository],
})
export class FileRepositoryModule {}
