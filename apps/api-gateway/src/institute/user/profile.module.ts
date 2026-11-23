import { Module } from '@nestjs/common';
import { ProfileResolver } from './profile.resolver';
import { ProfileService } from './profile.service';
import { ProfileRepositoryModule } from './repositories/profile-repository.module';

@Module({
  imports: [ProfileRepositoryModule],
  providers: [ProfileService, ProfileResolver],
  exports: [ProfileService],
})
export class ProfileModule {}
