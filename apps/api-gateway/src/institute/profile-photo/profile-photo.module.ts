import { Module } from '@nestjs/common';
import { FilesModule } from '../../files/files.module';
import { ProfilePhotoResolver } from './profile-photo.resolver';
import { ProfilePhotoTargetRepository } from './profile-photo-target.repository';

@Module({
  imports: [FilesModule],
  providers: [ProfilePhotoResolver, ProfilePhotoTargetRepository],
})
export class ProfilePhotoModule {}
